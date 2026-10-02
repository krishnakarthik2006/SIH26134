"""
Generate synthetic O*NET-style career dataset CSVs for SkillSync analytics.

Produces the five files expected by career_analytics.py and the import script:
  occupation_data.csv       — 1,016 occupation records
  essential_skills.csv      — skill importance + level ratings per occupation
  software_skills.csv       — software / tool mentions per occupation
  education.csv             — education requirement ratings per occupation
  related_occupations.csv   — peer occupation links

Output folder: ../../career_projects  (two levels up from this script's location)
Override with --folder <path>

Run:
    python scripts/generate_career_datasets.py
    python scripts/generate_career_datasets.py --folder C:/career_projects
"""

from __future__ import annotations

import argparse
import csv
import os
import random
import sys
from pathlib import Path

SEED = 42
random.seed(SEED)

# ── Occupation catalogue ──────────────────────────────────────────────────────
# Each entry: (SOC-style code, title, description, education_band, primary_skill_group)
# education_band: 1=secondary, 2=undergraduate, 3=graduate, 4=advanced
OCCUPATION_TEMPLATES: list[tuple[str, str, str, int, str]] = [
    # Software & IT (undergraduate / graduate heavy)
    ("15-1252.00", "Software Developers", "Design, develop, and maintain software applications.", 2, "software"),
    ("15-1253.00", "Software Quality Assurance Analysts and Testers", "Test software to identify defects and ensure quality.", 2, "software"),
    ("15-1254.00", "Web Developers", "Create and maintain websites and web applications.", 2, "software"),
    ("15-1255.00", "Web and Digital Interface Designers", "Design the visual layout and user interface of websites.", 2, "software"),
    ("15-1211.00", "Computer Systems Analysts", "Study an organization's computer systems and design improvements.", 2, "software"),
    ("15-1212.00", "Information Security Analysts", "Plan and implement security measures to protect computer networks.", 2, "software"),
    ("15-1221.00", "Computer and Information Research Scientists", "Invent and design new approaches to computing technology.", 3, "software"),
    ("15-1231.00", "Computer Network Support Specialists", "Analyze, test, troubleshoot, and evaluate existing network systems.", 2, "networking"),
    ("15-1232.00", "Computer User Support Specialists", "Provide technical assistance to computer users.", 1, "networking"),
    ("15-1241.00", "Computer Network Architects", "Design and build data communication networks.", 3, "networking"),
    ("15-1242.00", "Database Administrators", "Use software to store and organize data.", 2, "data"),
    ("15-1243.00", "Database Architects", "Design strategies for enterprise databases.", 3, "data"),
    ("15-1244.00", "Network and Computer Systems Administrators", "Install, configure, and maintain an organization's computer systems.", 2, "networking"),
    ("15-1251.00", "Computer Programmers", "Write, test, and maintain code for software programs.", 2, "software"),
    ("15-2051.00", "Data Scientists", "Use data analysis tools to identify patterns and extract insights.", 3, "data"),
    ("15-2041.00", "Statisticians", "Apply statistical methods to collect, analyze, and interpret data.", 3, "data"),
    ("15-2031.00", "Operations Research Analysts", "Use mathematics and logic to help organizations solve problems.", 3, "data"),
    ("15-1299.08", "Computer Systems Engineers/Architects", "Design and develop solutions to complex applications problems.", 3, "software"),
    ("15-1299.09", "Information Technology Project Managers", "Plan, initiate, and manage information technology projects.", 2, "management"),
    ("15-1299.05", "Information Security Engineers", "Develop and oversee the implementation of information security.", 3, "software"),

    # Data & Analytics
    ("15-2099.01", "Bioinformatics Technicians", "Apply principles of computer science to the field of biology.", 2, "data"),
    ("15-1299.04", "Penetration Testers", "Evaluate network and system security by attempting to breach them.", 2, "software"),
    ("15-2021.00", "Mathematicians", "Conduct research in fundamental mathematics.", 3, "data"),
    ("19-3022.00", "Survey Researchers", "Design surveys, collect data, and analyze data to answer questions.", 2, "data"),
    ("43-9111.00", "Statistical Assistants", "Compile and compute data according to statistical formulas.", 1, "data"),

    # Engineering — Mechanical
    ("17-2141.00", "Mechanical Engineers", "Research, design, develop, build, and test mechanical devices.", 2, "mechanical"),
    ("17-2141.01", "Fuel Cell Engineers", "Design, evaluate, modify, or construct fuel cell components.", 3, "mechanical"),
    ("17-2141.02", "Automotive Engineers", "Design, develop, or test self-propelled ground vehicles.", 3, "mechanical"),
    ("17-2151.00", "Mining and Geological Engineers", "Design open pit and underground mines.", 2, "civil"),
    ("17-2161.00", "Nuclear Engineers", "Research, design, develop, and monitor nuclear equipment.", 3, "mechanical"),
    ("17-2171.00", "Petroleum Engineers", "Design methods for extracting oil and gas from deposits.", 2, "mechanical"),
    ("17-2181.00", "Environmental Engineers", "Use principles of engineering, soil science, biology, and chemistry.", 2, "civil"),
    ("17-2199.00", "Engineers, All Other", "All engineers not listed separately.", 2, "mechanical"),
    ("17-2011.00", "Aerospace Engineers", "Design aircraft, spacecraft, satellites, and missiles.", 3, "mechanical"),
    ("17-2021.00", "Agricultural Engineers", "Apply knowledge of engineering technology and sciences to agricultural problems.", 2, "civil"),
    ("17-2031.00", "Bioengineers and Biomedical Engineers", "Apply knowledge of engineering, biology, and biomechanical principles.", 3, "mechanical"),
    ("17-2041.00", "Chemical Engineers", "Apply principles of chemistry, biology, and physics to solve problems.", 3, "mechanical"),
    ("17-2051.00", "Civil Engineers", "Perform engineering duties in planning, designing, and overseeing construction.", 2, "civil"),
    ("17-2061.00", "Computer Hardware Engineers", "Research, design, develop, or test computer or computer-related equipment.", 3, "software"),
    ("17-2071.00", "Electrical Engineers", "Research, design, develop, test, or supervise the manufacturing of electrical equipment.", 2, "electrical"),
    ("17-2072.00", "Electronics Engineers, Except Computer", "Research, design, develop, or test electronic components.", 2, "electrical"),
    ("17-2081.00", "Environmental Engineers", "Use engineering principles to develop solutions to environmental problems.", 2, "civil"),
    ("17-2111.00", "Health and Safety Engineers", "Promote worksite and product safety by applying engineering principles.", 2, "civil"),
    ("17-2112.00", "Industrial Engineers", "Design, develop, test, and evaluate integrated systems.", 2, "industrial"),
    ("17-2121.00", "Marine Engineers and Naval Architects", "Design, build, and maintain ships, boats, and related equipment.", 3, "mechanical"),
    ("17-2131.00", "Materials Engineers", "Evaluate materials and develop machinery and processes to manufacture materials.", 3, "mechanical"),

    # Construction & Architecture
    ("17-1011.00", "Architects, Except Landscape and Naval", "Plan and design structures such as private residences and office buildings.", 2, "civil"),
    ("17-1012.00", "Landscape Architects", "Plan and design land areas for projects such as parks and other recreational facilities.", 2, "civil"),
    ("17-1021.00", "Cartographers and Photogrammetrists", "Research, study, and prepare maps and other spatial data.", 2, "data"),
    ("17-1022.00", "Surveyors", "Make precise measurements to determine property boundaries.", 2, "civil"),
    ("47-1011.00", "First-Line Supervisors of Construction Trades", "Directly supervise and coordinate activities of construction or extraction workers.", 1, "management"),
    ("47-2011.00", "Boilermakers", "Assemble, install, and repair boilers, closed vats, and other large vessels.", 1, "mechanical"),
    ("47-2031.00", "Carpenters", "Construct, erect, install, and repair structures and fixtures made from wood.", 1, "construction"),
    ("47-2051.00", "Cement Masons and Concrete Finishers", "Smooth and finish surfaces of poured concrete.", 1, "construction"),
    ("47-2061.00", "Construction Laborers", "Perform tasks involving physical labor at construction sites.", 1, "construction"),
    ("47-2073.00", "Operating Engineers and Other Construction Equipment Operators", "Operate construction equipment to excavate and grade earth.", 1, "construction"),
    ("47-2111.00", "Electricians", "Install, maintain, and repair electrical wiring, equipment, and fixtures.", 1, "electrical"),
    ("47-2121.00", "Glaziers", "Install glass in windows, skylights, storefronts, and display cases.", 1, "construction"),
    ("47-2131.00", "Insulation Workers, Floor, Ceiling, and Wall", "Line and cover structures with insulating materials.", 1, "construction"),
    ("47-2141.00", "Painters, Construction and Maintenance", "Paint walls, equipment, buildings, bridges, and other structural surfaces.", 1, "construction"),
    ("47-2152.00", "Plumbers, Pipefitters, and Steamfitters", "Assemble, install, alter, and repair pipe systems.", 1, "construction"),
    ("47-2161.00", "Plasterers and Stucco Masons", "Apply plaster, stucco, or similar materials to interior and exterior surfaces.", 1, "construction"),
    ("47-2171.00", "Reinforcing Iron and Rebar Workers", "Position and secure steel bars or mesh in concrete forms.", 1, "construction"),
    ("47-2181.00", "Roofers", "Cover roofs of structures with shingles, slate, asphalt, aluminum, and related materials.", 1, "construction"),
    ("47-2211.00", "Sheet Metal Workers", "Fabricate, assemble, install, and repair sheet metal products.", 1, "construction"),
    ("47-2221.00", "Structural Iron and Steel Workers", "Raise, place, and unite iron or steel girders, columns, and other structural members.", 1, "construction"),

    # Healthcare
    ("29-1141.00", "Registered Nurses", "Assess patient health problems and needs, develop and implement nursing care plans.", 2, "healthcare"),
    ("29-1171.00", "Nurse Practitioners", "Diagnose and treat acute, episodic, or chronic illness.", 3, "healthcare"),
    ("29-1151.00", "Nurse Anesthetists", "Administer anesthesia for surgery or other medical procedures.", 3, "healthcare"),
    ("29-1161.00", "Nurse Midwives", "Coordinate independent management of women's health care.", 3, "healthcare"),
    ("29-1021.00", "Dentists, General", "Diagnose and treat problems with patients' teeth, gums, and related parts of the mouth.", 3, "healthcare"),
    ("29-1022.00", "Oral and Maxillofacial Surgeons", "Perform surgery on the mouth, jaw, and face.", 4, "healthcare"),
    ("29-1023.00", "Orthodontists", "Examine, diagnose, and treat dental malocclusions and oral cavity anomalies.", 4, "healthcare"),
    ("29-1031.00", "Dietitians and Nutritionists", "Plan and conduct food service or nutritional programs.", 2, "healthcare"),
    ("29-1041.00", "Optometrists", "Diagnose, manage, and treat conditions and diseases of the human eye.", 3, "healthcare"),
    ("29-1051.00", "Pharmacists", "Dispense prescription medications to patients.", 3, "healthcare"),
    ("29-1062.00", "Family Medicine Physicians", "Diagnose, treat, and help prevent diseases and injuries.", 3, "healthcare"),
    ("29-1063.00", "Internists, General", "Diagnose and provide non-surgical treatment of a wide range of diseases.", 4, "healthcare"),
    ("29-1064.00", "Obstetricians and Gynecologists", "Provide medical care related to pregnancy, childbirth, and disorders of the reproductive system.", 4, "healthcare"),
    ("29-1065.00", "Pediatricians, General", "Diagnose, treat, and help prevent children's diseases and injuries.", 4, "healthcare"),
    ("29-1071.00", "Physician Assistants", "Practice medicine with physician supervision.", 3, "healthcare"),
    ("29-1081.00", "Podiatrists", "Diagnose and treat diseases and deformities of the human foot.", 3, "healthcare"),
    ("29-1122.00", "Occupational Therapists", "Assess, plan, and organize rehabilitative programs.", 3, "healthcare"),
    ("29-1123.00", "Physical Therapists", "Assess, plan, organize, and participate in rehabilitative programs.", 3, "healthcare"),
    ("29-1124.00", "Radiation Therapists", "Provide radiation therapy to patients as prescribed by a radiologist.", 2, "healthcare"),
    ("29-1125.00", "Recreational Therapists", "Plan, direct, and coordinate medically approved recreation programs.", 2, "healthcare"),
    ("29-1126.00", "Respiratory Therapists", "Assess, treat, and care for patients with breathing disorders.", 2, "healthcare"),
    ("29-1127.00", "Speech-Language Pathologists", "Assess and treat persons with speech, language, voice, and fluency disorders.", 3, "healthcare"),
    ("29-1128.00", "Exercise Physiologists", "Assess, plan, or implement fitness programs.", 2, "healthcare"),
    ("29-1129.02", "Music Therapists", "Apply evidence-based music interventions to accomplish individualized goals.", 2, "healthcare"),
    ("29-1215.00", "Family Medicine Physicians", "Provide primary care to patients of all ages.", 3, "healthcare"),

    # Education
    ("25-1011.00", "Business Teachers, Postsecondary", "Teach courses in business administration and management.", 3, "education"),
    ("25-1021.00", "Computer Science Teachers, Postsecondary", "Teach courses in computer science.", 3, "education"),
    ("25-1022.00", "Mathematical Science Teachers, Postsecondary", "Teach courses in mathematical sciences.", 3, "education"),
    ("25-1032.00", "Vocational Education Teachers, Postsecondary", "Teach or instruct vocational or occupational subjects.", 2, "education"),
    ("25-1041.00", "Agricultural Sciences Teachers, Postsecondary", "Teach courses in agriculture and agricultural sciences.", 3, "education"),
    ("25-1042.00", "Biological Science Teachers, Postsecondary", "Teach courses in biological sciences.", 3, "education"),
    ("25-1043.00", "Forestry and Conservation Science Teachers, Postsecondary", "Teach courses in environmental and conservation science.", 3, "education"),
    ("25-1051.00", "Atmospheric, Earth, Marine, and Space Sciences Teachers, Postsecondary", "Teach courses in astronomy, meteorology, and other earth sciences.", 3, "education"),
    ("25-1052.00", "Chemistry Teachers, Postsecondary", "Teach courses in chemistry.", 3, "education"),
    ("25-1053.00", "Environmental Science Teachers, Postsecondary", "Teach courses in environmental science.", 3, "education"),
    ("25-1054.00", "Physics Teachers, Postsecondary", "Teach courses in physics.", 3, "education"),
    ("25-1061.00", "Anthropology and Archeology Teachers, Postsecondary", "Teach courses in anthropology and archeology.", 3, "education"),
    ("25-1062.00", "Area, Ethnic, and Cultural Studies Teachers, Postsecondary", "Teach courses in area, ethnic, and cultural studies.", 3, "education"),
    ("25-1063.00", "Economics Teachers, Postsecondary", "Teach courses in economics.", 3, "education"),
    ("25-1064.00", "Geography Teachers, Postsecondary", "Teach courses in geography.", 3, "education"),
    ("25-1065.00", "Political Science Teachers, Postsecondary", "Teach courses in political science.", 3, "education"),
    ("25-1066.00", "Psychology Teachers, Postsecondary", "Teach courses in psychology.", 3, "education"),
    ("25-1067.00", "Sociology Teachers, Postsecondary", "Teach courses in sociology.", 3, "education"),
    ("25-1069.00", "Social Sciences Teachers, Postsecondary, All Other", "Teach courses in social sciences not listed separately.", 3, "education"),
    ("25-1071.00", "Health Specialties Teachers, Postsecondary", "Teach courses in health specialties.", 3, "education"),
    ("25-1072.00", "Nursing Instructors and Teachers, Postsecondary", "Demonstrate and teach patient care in classroom and clinical units.", 3, "education"),
    ("25-1081.00", "Education Teachers, Postsecondary", "Teach courses pertaining to education.", 3, "education"),
    ("25-1082.00", "Library Science Teachers, Postsecondary", "Teach courses in library science.", 3, "education"),
    ("25-1111.00", "Criminal Justice and Law Enforcement Teachers, Postsecondary", "Teach courses in criminal justice.", 3, "education"),
    ("25-1112.00", "Law Teachers, Postsecondary", "Teach courses in law.", 4, "education"),
    ("25-1113.00", "Social Work Teachers, Postsecondary", "Teach courses in social work.", 3, "education"),
    ("25-1121.00", "Art, Drama, and Music Teachers, Postsecondary", "Teach theoretical and applied aspects of arts.", 3, "education"),
    ("25-1122.00", "Communications Teachers, Postsecondary", "Teach courses in communications.", 3, "education"),
    ("25-1123.00", "English Language and Literature Teachers, Postsecondary", "Teach courses in English language and literature.", 3, "education"),
    ("25-1124.00", "Foreign Language and Literature Teachers, Postsecondary", "Teach courses in foreign language and literature.", 3, "education"),
    ("25-1125.00", "History Teachers, Postsecondary", "Teach courses in human history.", 3, "education"),
    ("25-1126.00", "Philosophy and Religion Teachers, Postsecondary", "Teach courses in philosophy, religion, and theology.", 3, "education"),
    ("25-1191.00", "Graduate Teaching Assistants", "Assist teaching faculty in higher education.", 2, "education"),
    ("25-1199.00", "Postsecondary Teachers, All Other", "All postsecondary teachers not listed separately.", 3, "education"),
    ("25-2011.00", "Preschool Teachers, Except Special Education", "Instruct children in activities designed to promote social, physical, and intellectual growth.", 2, "education"),
    ("25-2012.00", "Kindergarten Teachers, Except Special Education", "Teach academic and social skills to kindergarten students.", 2, "education"),
    ("25-2021.00", "Elementary School Teachers, Except Special Education", "Teach academic subjects to students in elementary schools.", 2, "education"),
    ("25-2022.00", "Middle School Teachers, Except Special and Career/Technical Education", "Teach students in middle school.", 2, "education"),
    ("25-2023.00", "Career/Technical Education Teachers, Middle School", "Teach vocational and career education courses to middle school students.", 2, "education"),
    ("25-2031.00", "Secondary School Teachers, Except Special and Career/Technical Education", "Instruct students in secondary school.", 2, "education"),
    ("25-2032.00", "Career/Technical Education Teachers, Secondary School", "Teach vocational, career and technical education courses to secondary school students.", 2, "education"),
    ("25-2051.00", "Special Education Teachers, Preschool", "Teach academic, social, and life skills to students with learning, emotional, or physical disabilities.", 2, "education"),
    ("25-2052.00", "Special Education Teachers, Kindergarten", "Teach elementary school students with learning, emotional, or physical disabilities.", 2, "education"),
    ("25-2053.00", "Special Education Teachers, Elementary School", "Teach elementary school students with learning, emotional, or physical disabilities.", 2, "education"),
    ("25-2054.00", "Special Education Teachers, Secondary School", "Teach secondary school students with learning, emotional, or physical disabilities.", 2, "education"),
    ("25-2055.00", "Special Education Teachers, All Other", "All special education teachers not listed separately.", 2, "education"),
    ("25-2059.00", "Special Education Teachers, All Other", "Teach academic, social, and life skills to students with special needs.", 2, "education"),
    ("25-3011.00", "Adult Basic Education, Adult Secondary Education, and English as a Second Language Instructors", "Teach adult students basic and secondary level subjects.", 2, "education"),
    ("25-3021.00", "Self-Enrichment Teachers", "Teach or instruct individuals or groups for the primary purpose of personal enrichment.", 1, "education"),
    ("25-3031.00", "Substitute Teachers, Short-Term", "Provide instruction on a short-term basis as a temporary replacement.", 1, "education"),
    ("25-3041.00", "Tutors", "Teach or instruct students individually outside of classroom settings.", 2, "education"),
    ("25-4011.00", "Archivists", "Appraise, edit, and direct safekeeping of permanent records and historically valuable documents.", 3, "education"),
    ("25-4012.00", "Curators", "Administer collections in museums and other cultural institutions.", 3, "education"),
    ("25-4013.00", "Museum Technicians and Conservators", "Restore, maintain, or prepare objects in museum collections.", 2, "education"),
    ("25-4021.00", "Librarians and Media Collections Specialists", "Administer library services.", 3, "education"),
    ("25-4022.00", "Library Technicians", "Assist librarians by helping library patrons.", 1, "education"),
    ("25-9011.00", "Audio-Visual and Multimedia Collections Specialists", "Prepare, plan, and operate audio-visual teaching aids.", 1, "education"),
    ("25-9031.00", "Instructional Coordinators", "Develop instructional material, coordinate educational content.", 3, "education"),
    ("25-9041.00", "Teacher Assistants", "Assist a preschool, elementary, middle, or secondary school teacher.", 1, "education"),

    # Business & Finance
    ("11-1011.00", "Chief Executives", "Determine and formulate policies and provide overall direction of companies.", 3, "management"),
    ("11-1021.00", "General and Operations Managers", "Plan, direct, or coordinate operations of an organization.", 2, "management"),
    ("11-1031.00", "Legislators", "Develop, introduce, or enact laws.", 2, "management"),
    ("11-2011.00", "Advertising and Promotions Managers", "Plan, direct, or coordinate advertising policies and programs.", 2, "management"),
    ("11-2021.00", "Marketing Managers", "Plan, direct, or coordinate marketing policies and programs.", 2, "management"),
    ("11-2022.00", "Sales Managers", "Plan, direct, or coordinate actual distribution of product or service to the customer.", 2, "management"),
    ("11-2031.00", "Public Relations and Fundraising Managers", "Plan, direct, or coordinate activities designed to create a favorable public image.", 2, "management"),
    ("11-3012.00", "Administrative Services and Facilities Managers", "Plan, direct, or coordinate supportive services of an organization.", 2, "management"),
    ("11-3013.00", "Facilities Managers", "Plan, direct, or coordinate operations and functionalities of facilities.", 2, "management"),
    ("11-3021.00", "Computer and Information Systems Managers", "Plan, direct, or coordinate activities in such fields as electronic data processing.", 3, "management"),
    ("11-3031.00", "Financial Managers", "Plan, direct, or coordinate accounting, investing, banking, insurance, securities.", 2, "finance"),
    ("11-3051.00", "Industrial Production Managers", "Plan, direct, or coordinate the work activities and resources necessary for manufacturing products.", 2, "industrial"),
    ("11-3061.00", "Purchasing Managers", "Plan, direct, or coordinate the activities of buyers, purchasing officers.", 2, "management"),
    ("11-3071.00", "Transportation, Storage, and Distribution Managers", "Plan, direct, or coordinate transportation, storage, or distribution activities.", 2, "management"),
    ("11-3111.00", "Compensation and Benefits Managers", "Plan, develop, implement, and administer compensation and benefits programs.", 2, "management"),
    ("11-3121.00", "Human Resources Managers", "Plan, direct, and coordinate human resource management activities.", 2, "management"),
    ("11-3131.00", "Training and Development Managers", "Plan, direct, or coordinate the training and development activities and staff.", 2, "management"),
    ("11-9013.00", "Farmers, Ranchers, and Other Agricultural Managers", "Plan, direct, or coordinate the management of agricultural activities.", 1, "management"),
    ("11-9021.00", "Construction Managers", "Plan, direct, or coordinate, usually through subordinate supervisory personnel, activities concerned with the construction and maintenance of structures.", 2, "management"),
    ("11-9031.00", "Education and Childcare Administrators, Preschool and Daycare", "Plan, direct, or coordinate the academic and nonacademic activities of preschool and childcare centers.", 3, "management"),
    ("11-9032.00", "Education Administrators, Kindergarten through Secondary", "Plan, direct, or coordinate the academic, administrative, or auxiliary activities of kindergarten through secondary schools.", 3, "management"),
    ("11-9033.00", "Education Administrators, Postsecondary", "Plan, direct, or coordinate research, instructional, student administration and services.", 3, "management"),
    ("11-9039.00", "Education Administrators, All Other", "All education administrators not listed separately.", 3, "management"),
    ("11-9041.00", "Architectural and Engineering Managers", "Plan, direct, or coordinate activities in such fields as architecture and engineering.", 3, "management"),
    ("11-9051.00", "Food Service Managers", "Plan, direct, or coordinate activities of an organization or department that serves food and beverages.", 1, "management"),
    ("11-9061.00", "Funeral Home Managers", "Plan, direct, or coordinate the services or resources of funeral homes.", 2, "management"),
    ("11-9071.00", "Gaming Managers", "Plan, direct, or coordinate gaming operations in a casino.", 2, "management"),
    ("11-9081.00", "Lodging Managers", "Plan, direct, or coordinate activities of an organization or department that provides lodging and other accommodations.", 2, "management"),
    ("11-9111.00", "Medical and Health Services Managers", "Plan, direct, or coordinate medical and health services.", 3, "management"),
    ("11-9121.00", "Natural Sciences Managers", "Plan, direct, or coordinate activities in such fields as life sciences, physical sciences, and social sciences.", 3, "management"),
    ("11-9131.00", "Postmasters and Mail Superintendents", "Direct and coordinate operational, administrative, management, and supportive services.", 2, "management"),
    ("11-9141.00", "Property, Real Estate, and Community Association Managers", "Plan, direct, or coordinate the selling, buying, leasing, or governance activities.", 2, "management"),
    ("11-9151.00", "Social and Community Service Managers", "Plan, direct, or coordinate the activities of a social service program.", 2, "management"),
    ("11-9161.00", "Emergency Management Directors", "Plan and direct disaster response or crisis management activities.", 2, "management"),
    ("11-9171.00", "Funeral Home Managers", "Plan, direct, or coordinate the services or resources of funeral homes.", 2, "management"),
    ("11-9199.00", "Managers, All Other", "All managers not listed separately.", 2, "management"),
    ("13-1011.00", "Agents and Business Managers of Artists, Performers, and Athletes", "Represent and promote artists, performers, and athletes.", 2, "management"),
    ("13-1021.00", "Buyers and Purchasing Agents, Farm Products", "Purchase farm products for further processing or resale.", 2, "management"),
    ("13-1022.00", "Wholesale and Retail Buyers, Except Farm Products", "Buy merchandise for resale to consumers at the wholesale or retail level.", 2, "management"),
    ("13-1023.00", "Purchasing Agents, Except Wholesale, Retail, and Farm Products", "Purchase machinery, equipment, tools, parts, supplies, or services.", 2, "management"),
    ("13-1031.00", "Claims Adjusters, Examiners, and Investigators", "Review claims and determine the appropriate amount of coverage.", 2, "finance"),
    ("13-1041.00", "Compliance Officers", "Examine, evaluate, and investigate eligibility for or conformity with laws and regulations.", 2, "management"),
    ("13-1051.00", "Cost Estimators", "Prepare cost estimates for product manufacturing, construction projects, or services.", 2, "finance"),
    ("13-1061.00", "Emergency Management Specialists", "Coordinate disaster response or crisis management activities.", 2, "management"),
    ("13-1071.00", "Human Resources Specialists", "Recruit, screen, interview, or place individuals within an organization.", 2, "management"),
    ("13-1075.00", "Labor Relations Specialists", "Resolve disputes between workers and managers, negotiate collective bargaining agreements.", 2, "management"),
    ("13-1081.00", "Logisticians", "Analyze and coordinate the logistical functions of a firm or organization.", 2, "management"),
    ("13-1082.00", "Project Management Specialists", "Analyze and coordinate the schedule, timeline, procurement, staffing, and budget.", 2, "management"),
    ("13-1111.00", "Management Analysts", "Conduct organizational studies and evaluations, design systems and procedures.", 2, "management"),
    ("13-1121.00", "Meeting, Convention, and Event Planners", "Coordinate activities of staff and convention personnel to make arrangements.", 2, "management"),
    ("13-1131.00", "Fundraisers", "Organize activities to raise funds or otherwise solicit and gather monetary donations.", 2, "management"),
    ("13-1141.00", "Compensation, Benefits, and Job Analysis Specialists", "Conduct programs of compensation and benefits and job analysis.", 2, "finance"),
    ("13-1151.00", "Training and Development Specialists", "Design or conduct work-related training and development programs.", 2, "management"),
    ("13-1161.00", "Market Research Analysts and Marketing Specialists", "Research conditions in local, regional, national, or online markets.", 2, "data"),
    ("13-1199.00", "Business Operations Specialists, All Other", "All business operations specialists not listed separately.", 2, "management"),
    ("13-2011.00", "Accountants and Auditors", "Examine and prepare financial records.", 2, "finance"),
    ("13-2021.00", "Appraisers and Assessors of Real Estate", "Estimate the value of real estate property.", 2, "finance"),
    ("13-2031.00", "Budget Analysts", "Examine budget estimates for completeness, accuracy, and conformance with procedures.", 2, "finance"),
    ("13-2041.00", "Credit Analysts", "Analyze credit data and financial statements of individuals or firms.", 2, "finance"),
    ("13-2051.00", "Financial and Investment Analysts", "Assess the performance of stocks, bonds, and other types of investments.", 2, "finance"),
    ("13-2052.00", "Personal Financial Advisors", "Advise clients on financial plans.", 2, "finance"),
    ("13-2053.00", "Insurance Underwriters", "Review insurance applications and determine coverage amounts and premiums.", 2, "finance"),
    ("13-2061.00", "Financial Examiners", "Enforce or ensure compliance with laws and regulations governing financial and securities institutions.", 2, "finance"),
    ("13-2071.00", "Credit Counselors", "Advise and educate individuals or organizations on acquiring and managing debt.", 2, "finance"),
    ("13-2072.00", "Loan Officers", "Evaluate, authorize, or recommend approval of commercial, real estate, or credit loans.", 2, "finance"),
    ("13-2081.00", "Tax Examiners and Collectors, and Revenue Agents", "Determine tax liability or collect taxes from individuals or business firms.", 2, "finance"),
    ("13-2082.00", "Tax Preparers", "Prepare tax returns for individuals or small businesses.", 1, "finance"),
    ("13-2099.00", "Financial Specialists, All Other", "All financial specialists not listed separately.", 2, "finance"),
]

# Pad out to exactly 1016 records by generating occupations with varied codes
def generate_extended_occupations(base: list, target: int = 1016) -> list:
    result = list(base)
    sectors = [
        ("Arts / Media", "arts", 2), ("Legal", "legal", 3),
        ("Science", "science", 3), ("Social Services", "social", 2),
        ("Agriculture", "agriculture", 1), ("Manufacturing", "manufacturing", 1),
        ("Transportation", "transport", 1), ("Sales", "sales", 1),
        ("Administrative", "admin", 1),
    ]
    counter = len(result)
    sector_index = 0
    while len(result) < target:
        sector_name, skill_group, edu = sectors[sector_index % len(sectors)]
        code_major = 99
        code_minor = 1000 + counter
        code = f"{code_major:02d}-{code_minor:04d}.{(counter % 99) + 1:02d}"
        title = f"{sector_name} Specialist {counter - len(base) + 1}"
        description = (
            f"Perform specialized duties in the {sector_name.lower()} sector, "
            f"applying technical expertise and domain knowledge to achieve organizational objectives."
        )
        result.append((code, title, description, edu, skill_group))
        counter += 1
        sector_index += 1
    return result[:target]


OCCUPATIONS = generate_extended_occupations(OCCUPATION_TEMPLATES, 1016)

# ── Skill definitions ─────────────────────────────────────────────────────────
# (element_id, element_name, group)
SKILLS = [
    ("2.A.1.a", "Reading Comprehension", "basic"),
    ("2.A.1.b", "Active Listening", "basic"),
    ("2.A.1.c", "Writing", "basic"),
    ("2.A.1.d", "Speaking", "basic"),
    ("2.A.1.e", "Mathematics", "basic"),
    ("2.A.1.f", "Science", "basic"),
    ("2.A.2.a", "Critical Thinking", "cross"),
    ("2.A.2.b", "Active Learning", "cross"),
    ("2.A.2.c", "Learning Strategies", "cross"),
    ("2.A.2.d", "Monitoring", "cross"),
    ("2.A.3.a", "Social Perceptiveness", "social"),
    ("2.A.3.b", "Coordination", "social"),
    ("2.A.3.c", "Persuasion", "social"),
    ("2.A.3.d", "Negotiation", "social"),
    ("2.A.3.e", "Instructing", "social"),
    ("2.A.3.f", "Service Orientation", "social"),
    ("2.A.4.a", "Complex Problem Solving", "complex"),
    ("2.B.1.a", "Operations Analysis", "systems"),
    ("2.B.1.b", "Technology Design", "systems"),
    ("2.B.2.a", "Equipment Selection", "technical"),
    ("2.B.2.b", "Installation", "technical"),
    ("2.B.2.c", "Programming", "technical"),
    ("2.B.2.d", "Operations Monitoring", "technical"),
    ("2.B.2.e", "Operation and Control", "technical"),
    ("2.B.2.f", "Equipment Maintenance", "technical"),
    ("2.B.2.g", "Troubleshooting", "technical"),
    ("2.B.2.h", "Repairing", "technical"),
    ("2.B.2.i", "Quality Control Analysis", "technical"),
    ("2.B.3.a", "Judgment and Decision Making", "systems"),
    ("2.B.3.b", "Systems Analysis", "systems"),
    ("2.B.3.c", "Systems Evaluation", "systems"),
    ("2.B.4.a", "Time Management", "resource"),
    ("2.B.4.b", "Management of Financial Resources", "resource"),
    ("2.B.4.c", "Management of Material Resources", "resource"),
    ("2.B.4.d", "Management of Personnel Resources", "resource"),
]

# Skill groups that are relevant per occupation skill_group
SKILL_RELEVANCE = {
    "software": {"basic", "cross", "complex", "systems", "technical"},
    "networking": {"basic", "cross", "technical", "systems"},
    "data": {"basic", "cross", "complex", "systems", "technical"},
    "mechanical": {"basic", "cross", "technical", "complex"},
    "electrical": {"basic", "cross", "technical"},
    "civil": {"basic", "cross", "technical", "systems"},
    "industrial": {"basic", "cross", "technical", "resource"},
    "construction": {"basic", "cross", "technical"},
    "healthcare": {"basic", "cross", "social", "complex"},
    "education": {"basic", "cross", "social"},
    "management": {"basic", "cross", "social", "resource", "complex"},
    "finance": {"basic", "cross", "complex", "systems"},
    "arts": {"basic", "cross", "social"},
    "legal": {"basic", "cross", "social", "complex"},
    "science": {"basic", "cross", "complex", "systems", "technical"},
    "social": {"basic", "cross", "social"},
    "agriculture": {"basic", "cross", "technical"},
    "manufacturing": {"basic", "cross", "technical"},
    "transport": {"basic", "cross", "technical"},
    "sales": {"basic", "cross", "social"},
    "admin": {"basic", "cross", "social", "resource"},
}

# ── Software / tool catalogue ─────────────────────────────────────────────────
SOFTWARE_BY_GROUP = {
    "software":    [("2.C.3.b", "Programming tools"), ("2.C.3.a", "Development software"),
                    ("2.C.4",   "Database software"),  ("2.C.5",   "Project management software")],
    "networking":  [("2.C.3.c", "Network management software"), ("2.C.4", "Database software")],
    "data":        [("2.C.3.d", "Statistical analysis software"), ("2.C.3.e", "Analytical software"),
                    ("2.C.4",   "Database software")],
    "mechanical":  [("2.C.3.f", "CAD software"), ("2.C.3.g", "Simulation software")],
    "electrical":  [("2.C.3.h", "Circuit design software")],
    "civil":       [("2.C.3.f", "CAD software"), ("2.C.3.i", "GIS software")],
    "industrial":  [("2.C.3.j", "ERP software"), ("2.C.5", "Project management software")],
    "construction":[("2.C.3.f", "CAD software")],
    "healthcare":  [("2.C.1",   "Medical software"), ("2.C.2", "Electronic health record software")],
    "education":   [("2.C.5",   "Project management software"), ("2.C.6", "Course management software")],
    "management":  [("2.C.5",   "Project management software"), ("2.C.4", "Database software")],
    "finance":     [("2.C.3.k", "Accounting software"), ("2.C.3.d", "Statistical analysis software")],
    "arts":        [("2.C.3.l", "Graphics software"), ("2.C.5", "Project management software")],
    "legal":       [("2.C.3.m", "Legal research software"), ("2.C.5", "Project management software")],
    "science":     [("2.C.3.d", "Statistical analysis software"), ("2.C.3.e", "Analytical software")],
    "social":      [("2.C.5",   "Project management software"), ("2.C.1", "Case management software")],
    "agriculture": [("2.C.3.f", "CAD software"), ("2.C.3.n", "Agricultural software")],
    "manufacturing":[("2.C.3.j","ERP software"), ("2.C.3.f", "CAD software")],
    "transport":   [("2.C.3.o", "Fleet management software"), ("2.C.5", "Routing software")],
    "sales":       [("2.C.3.p", "CRM software"), ("2.C.5", "Sales software")],
    "admin":       [("2.C.5",   "Project management software"), ("2.C.3.q", "Office software")],
}

# Concrete tool examples per software element (workplace examples)
TOOL_EXAMPLES = {
    "2.C.3.b": ["GitHub", "Visual Studio Code", "IntelliJ IDEA", "Eclipse", "Xcode"],
    "2.C.3.a": ["Microsoft Visual Studio", "Atom", "Sublime Text", "Notepad++", "NetBeans"],
    "2.C.4":   ["Oracle Database", "MySQL", "Microsoft SQL Server", "PostgreSQL", "MongoDB"],
    "2.C.5":   ["Microsoft Project", "Jira", "Asana", "Trello", "Monday.com"],
    "2.C.3.c": ["Cisco IOS", "SolarWinds Network Performance Monitor", "Wireshark", "Nagios", "PRTG Network Monitor"],
    "2.C.3.d": ["SAS", "IBM SPSS Statistics", "R", "Stata", "Minitab"],
    "2.C.3.e": ["Tableau", "Microsoft Power BI", "QlikView", "SAP BusinessObjects", "Spotfire"],
    "2.C.3.f": ["Autodesk AutoCAD", "Dassault Systemes CATIA", "PTC Creo Parametric", "SolidWorks", "Bentley MicroStation"],
    "2.C.3.g": ["MATLAB", "Simulink", "ANSYS", "COMSOL Multiphysics", "Arena Simulation Software"],
    "2.C.3.h": ["Cadence OrCAD", "Mentor Graphics PADS", "National Instruments LabVIEW", "Altium Designer"],
    "2.C.3.i": ["Esri ArcGIS", "QGIS", "MapInfo Professional", "Global Mapper", "Google Earth Pro"],
    "2.C.3.j": ["SAP ERP", "Oracle E-Business Suite", "Microsoft Dynamics 365", "NetSuite", "Epicor ERP"],
    "2.C.1":   ["Epic Systems", "Cerner", "Meditech Expanse", "Allscripts", "eClinicalWorks"],
    "2.C.2":   ["Microsoft 365", "DocuSign", "MedMaster", "AdvancedMD", "Kareo Clinical"],
    "2.C.6":   ["Blackboard", "Canvas LMS", "Moodle", "Google Classroom", "Schoology"],
    "2.C.3.k": ["QuickBooks", "Intuit TurboTax", "Sage 50 Accounting", "FreshBooks", "Xero"],
    "2.C.3.l": ["Adobe Creative Cloud", "CorelDRAW", "Affinity Designer", "Sketch", "Figma"],
    "2.C.3.m": ["LexisNexis", "Westlaw", "CaseMap", "Thomson Reuters Practical Law"],
    "2.C.3.n": ["Farm Works Software", "Trimble Ag Software", "AgLeader SMS"],
    "2.C.3.o": ["TMWSuite", "PeopleNet Fleet Manager", "Samsara", "Omnitracs"],
    "2.C.3.p": ["Salesforce", "HubSpot CRM", "Zoho CRM", "Microsoft Dynamics CRM"],
    "2.C.3.q": ["Microsoft Office", "Google Workspace", "LibreOffice", "Zoho Office Suite"],
}

# Hot / in-demand tool sets
HOT_TOOLS = {"GitHub", "Visual Studio Code", "Tableau", "Microsoft Power BI", "SAS",
             "Oracle Database", "Salesforce", "SAP ERP", "Epic Systems"}
IN_DEMAND_TOOLS = {"GitHub", "Visual Studio Code", "IntelliJ IDEA", "MySQL", "PostgreSQL",
                   "MongoDB", "Jira", "Tableau", "Microsoft Power BI", "Salesforce",
                   "Microsoft 365", "SAP ERP", "Esri ArcGIS"}

# ── Education scale definitions ───────────────────────────────────────────────
# category → scale RL categories
# Bands:
#  1 Secondary / certificate → categories 1-3
#  2 Undergraduate           → categories 4-6
#  3 Graduate / professional → categories 7-9
#  4 Advanced professional   → categories 10-12
EDU_BAND_CATEGORIES = {
    1: [("1", "Less than a High School Diploma"),
        ("2", "High School Diploma or equivalent"),
        ("3", "Post-Secondary Certificate")],
    2: [("4", "Some College Courses"),
        ("5", "Associate's Degree (or other 2-year degree)"),
        ("6", "Bachelor's Degree")],
    3: [("7", "Post-Baccalaureate Certificate"),
        ("8", "Master's Degree"),
        ("9", "Post-Master's Certificate")],
    4: [("10", "First Professional Degree"),
        ("11", "Doctoral Degree"),
        ("12", "Post-Doctoral Training")],
}

EDU_ELEMENT_ID = "5.C.1"
EDU_ELEMENT_NAME = "Required Level of Education"


# ── CSV writer helpers ────────────────────────────────────────────────────────

def write_csv(path: Path, headers: list[str], rows: list[list]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(headers)
        writer.writerows(rows)
    print(f"  Wrote {len(rows):,} rows  →  {path}")


def fmt(value: float) -> str:
    return f"{value:.2f}"


# ── Generators ────────────────────────────────────────────────────────────────

def generate_occupation_data(occupations: list) -> list[list]:
    rows = []
    for code, title, description, _edu, _group in occupations:
        rows.append([code, title, description])
    return rows


def generate_essential_skills(occupations: list) -> list[list]:
    rows = []
    rng = random.Random(SEED)
    for code, _title, _desc, edu, skill_group in occupations:
        relevant_groups = SKILL_RELEVANCE.get(skill_group, {"basic", "cross"})
        for elem_id, elem_name, skill_group_tag in SKILLS:
            if skill_group_tag not in relevant_groups:
                # Still include some skills with low importance/relevance
                if rng.random() > 0.25:
                    continue
            # Base importance influenced by education level (more education → broader skills)
            base_importance = rng.uniform(1.5 + edu * 0.3, 3.5 + edu * 0.2)
            base_level = rng.uniform(1.0 + edu * 0.2, 3.0 + edu * 0.25)
            # Clamp to O*NET scale 1-5
            importance = round(min(max(base_importance, 1.0), 5.0), 2)
            level = round(min(max(base_level, 0.5), 7.0), 2)

            # Not Relevant flag — low importance skills occasionally flagged
            not_relevant = "Y" if importance < 1.5 and rng.random() < 0.3 else "N"

            for scale_id, value in [("IM", importance), ("LV", level)]:
                rows.append([
                    code, elem_id, elem_name, scale_id,
                    fmt(value), not_relevant, "N",  # Recommend Suppress = N
                ])
    return rows


def generate_software_skills(occupations: list) -> list[list]:
    rows = []
    rng = random.Random(SEED + 1)
    for code, _title, _desc, _edu, skill_group in occupations:
        sw_list = SOFTWARE_BY_GROUP.get(skill_group, SOFTWARE_BY_GROUP["admin"])
        for elem_id, elem_name in sw_list:
            tools = TOOL_EXAMPLES.get(elem_id, [f"Generic Tool for {elem_name}"])
            # Each occupation gets a random subset of tools for each software element
            n_tools = rng.randint(1, min(3, len(tools)))
            selected_tools = rng.sample(tools, n_tools)
            for tool in selected_tools:
                hot = "Y" if tool in HOT_TOOLS else "N"
                in_demand = "Y" if tool in IN_DEMAND_TOOLS else "N"
                rows.append([code, elem_id, elem_name, tool, hot, in_demand])
    return rows


def generate_education(occupations: list) -> list[list]:
    """
    Generate RL-scale education records.
    For each occupation, the dominant band (matching edu level) gets high values (40-70),
    adjacent bands get moderate values (10-30), and distant bands get low values (1-10).
    """
    rows = []
    rng = random.Random(SEED + 2)
    for code, _title, _desc, edu_band, _group in occupations:
        for band_index, (band_num, category_list) in enumerate(EDU_BAND_CATEGORIES.items(), 1):
            distance = abs(band_index - edu_band)
            for category_code, _category_name in category_list:
                if distance == 0:
                    value = rng.uniform(30, 70)
                elif distance == 1:
                    value = rng.uniform(5, 25)
                else:
                    value = rng.uniform(1, 8)
                rows.append([
                    code, EDU_ELEMENT_ID, EDU_ELEMENT_NAME, "RL",
                    category_code, fmt(round(value, 2)), "N",
                ])
    return rows


def generate_related_occupations(occupations: list) -> list[list]:
    rows = []
    rng = random.Random(SEED + 3)
    codes_and_titles = [(code, title) for code, title, *_ in occupations]
    tier_labels = ["Closely Related", "Related", "Somewhat Related"]

    for code, title, *_ in occupations:
        # Pick 2-5 related occupations
        n_related = rng.randint(2, 5)
        pool = [(c, t) for c, t in codes_and_titles if c != code]
        related_sample = rng.sample(pool, min(n_related, len(pool)))
        for rank, (related_code, related_title) in enumerate(related_sample, start=1):
            tier = tier_labels[min(rank - 1, 2)]
            rows.append([code, title, related_code, related_title, tier, str(rank)])
    return rows


# ── Main ──────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate SkillSync career dataset CSVs")
    default_folder = str(Path(__file__).resolve().parents[2] / "career_projects")
    parser.add_argument("--folder", default=default_folder, help="Output folder for CSV files")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    out = Path(args.folder)
    out.mkdir(parents=True, exist_ok=True)

    print(f"\nGenerating career datasets → {out}")
    print(f"  Occupations to generate: {len(OCCUPATIONS):,}")

    # occupation_data.csv
    occ_rows = generate_occupation_data(OCCUPATIONS)
    write_csv(
        out / "occupation_data.csv",
        ["O*NET-SOC Code", "Title", "Description"],
        occ_rows,
    )

    # essential_skills.csv
    skill_rows = generate_essential_skills(OCCUPATIONS)
    write_csv(
        out / "essential_skills.csv",
        ["O*NET-SOC Code", "Element ID", "Element Name", "Scale ID",
         "Data Value", "Not Relevant", "Recommend Suppress"],
        skill_rows,
    )

    # software_skills.csv
    sw_rows = generate_software_skills(OCCUPATIONS)
    write_csv(
        out / "software_skills.csv",
        ["O*NET-SOC Code", "Element ID", "Element Name", "Workplace Example",
         "Hot Technology", "In Demand"],
        sw_rows,
    )

    # education.csv
    edu_rows = generate_education(OCCUPATIONS)
    write_csv(
        out / "education.csv",
        ["O*NET-SOC Code", "Element ID", "Element Name", "Scale ID",
         "Category", "Data Value", "Recommend Suppress"],
        edu_rows,
    )

    # related_occupations.csv
    rel_rows = generate_related_occupations(OCCUPATIONS)
    write_csv(
        out / "related_occupations.csv",
        ["O*NET-SOC Code", "Title", "Related O*NET-SOC Code", "Related Title",
         "Relatedness Tier", "Index"],
        rel_rows,
    )

    print(f"\n✓ All 5 dataset files generated in: {out}")
    print(f"  occupation_data.csv     : {len(occ_rows):,} records")
    print(f"  essential_skills.csv    : {len(skill_rows):,} records")
    print(f"  software_skills.csv     : {len(sw_rows):,} records")
    print(f"  education.csv           : {len(edu_rows):,} records")
    print(f"  related_occupations.csv : {len(rel_rows):,} records")


if __name__ == "__main__":
    main()

import { MongoClient } from 'mongodb'
import { env } from './config/env.js'

const { mongodbUri: uri, mongodbDbName: databaseName } = env

export const domainCollections = [
  'users',
  'students',
  'skills',
  'skill_mappings',
  'industries',
  'job_roles',
  'job_descriptions',
  'training_providers',
  'training_programs',
  'curriculums',
  'extraction_results',
  'program_alignments',
  'skill_gaps',
  'readiness_scores',
  'courses',
  'recommendations',
  'learning_roadmaps',
  'assessments',
  'assessment_attempts',
  'skill_demand',
  'skill_trends',
  'regional_skill_gaps',
  'reports',
  'government_profiles',
]

const indexes = {
  users: [[{ email: 1 }, { unique: true, sparse: true }], [{ role: 1 }]],
  students: [[{ userId: 1 }, { unique: true, sparse: true }], [{ targetRole: 1 }]],
  skills: [
    // Unique lookup by normalizedName (dedup guard)
    [{ normalizedName: 1 }, { unique: true, sparse: true }],
    // Filtering / sorting
    [{ category: 1 }],
    [{ type: 1 }],
    [{ demandLevel: 1 }],
    [{ demandScore: -1 }],
    [{ isDeleted: 1 }],
    // Array field lookups
    [{ aliases: 1 }],
    [{ tags: 1 }],
    [{ relatedSkillIds: 1 }],
    // Full-text search across name, aliases, description, tags
    [{ name: 'text', aliases: 'text', description: 'text', tags: 'text' }, { name: 'skills_text_idx' }],
  ],
  skill_mappings: [
    // Primary lookup — unique per source term (named to avoid collision with old non-unique index)
    [{ sourceTerm: 1 }, { unique: true, sparse: true, name: 'skill_mappings_sourceTerm_unique' }],
    // Reverse lookup — all aliases that map to a skill
    [{ skillId: 1 }],
    // Admin browsing
    [{ createdBy: 1 }],
    [{ createdAt: -1 }],
    [{ skillName: 1 }],
  ],
  industries: [
    [{ name: 1 }, { unique: true, sparse: true }],
    [{ userId: 1 }, { unique: true, sparse: true }],
    [{ sector: 1 }],
    [{ companySize: 1 }],
    [{ operatingRegions: 1 }],
    [{ isDeleted: 1 }],
    [{ createdBy: 1 }],
    [{ createdAt: -1 }],
  ],
  job_roles: [
    [{ industryId: 1, status: 1 }],
    [{ title: 1 }],
    [{ status: 1 }],
    [{ employmentType: 1 }],
    [{ workMode: 1 }],
    [{ isDeleted: 1 }],
    [{ createdBy: 1 }],
    [{ createdAt: -1 }],
    [{ tags: 1 }],
    [{ 'requiredSkills.skillId': 1 }],
    [{ title: 'text', description: 'text', tags: 'text', 'requiredSkills.skillName': 'text' }, { name: 'job_roles_text_idx' }],
  ],
  job_descriptions: [
    [{ jobRoleId: 1, createdAt: -1 }],
    [{ industryId: 1 }],
    [{ source: 1 }],
    [{ isDeleted: 1 }],
    [{ uploadedBy: 1 }],
  ],
  training_providers: [
    [{ name: 1 }, { unique: true, sparse: true }],
    [{ userId: 1 }, { unique: true, sparse: true }],
    [{ type: 1 }],
    [{ district: 1 }],
    [{ region: 1 }],
    [{ isDeleted: 1 }],
    [{ createdBy: 1 }],
    [{ createdAt: -1 }],
    [{ focusAreas: 1 }],
    [{ name: 'text', description: 'text', focusAreas: 'text' }, { name: 'training_providers_text_idx' }],
  ],
  training_programs: [
    [{ providerId: 1, status: 1 }],
    [{ status: 1 }],
    [{ deliveryMode: 1 }],
    [{ isDeleted: 1 }],
    [{ createdBy: 1 }],
    [{ createdAt: -1 }],
    [{ tags: 1 }],
    [{ targetRoles: 1 }],
    [{ certificationOffered: 1 }],
    [{ name: 'text', description: 'text', tags: 'text', targetRoles: 'text' }, { name: 'training_programs_text_idx' }],
  ],
  curriculums: [
    [{ trainingProgramId: 1, version: -1 }],
    [{ status: 1 }],
    [{ isDeleted: 1 }],
    [{ createdBy: 1 }],
    [{ createdAt: -1 }],
    [{ 'skillsCovered.skillId': 1 }],
    [{ 'skillsCovered.skillName': 1 }],
    [{ 'modules.moduleId': 1 }],
    [{ title: 'text', description: 'text', content: 'text' }, { name: 'curriculums_text_idx' }],
  ],
  extraction_results: [
    // Core lookups
    [{ sourceType: 1, sourceId: 1 }],
    [{ sourceType: 1 }],
    [{ sourceId: 1 }],
    // Status-based querying (pending retries, completed results)
    [{ status: 1 }],
    [{ status: 1, createdAt: -1 }],
    // Owner-based lookups
    [{ submittedBy: 1, createdAt: -1 }],
    // Time-based sorting / TTL candidates
    [{ createdAt: -1 }],
    [{ completedAt: -1 }],
    // Extracted skill lookups (for gap analysis queries)
    [{ 'extractedSkills.normalizedName': 1 }],
    [{ 'extractedSkills.category': 1 }],
  ],
  program_alignments: [[{ trainingProgramId: 1, jobRoleId: 1 }], [{ score: -1 }]],
  skill_gaps: [
    // Primary query pattern: all gaps for a given subject + role
    [{ subjectType: 1, subjectId: 1, targetRole: 1 }],
    [{ subjectType: 1, subjectId: 1 }],
    // Filter by priority for surfacing critical gaps
    [{ priority: -1 }],
    [{ priority: 1 }],
    // Status filtering (open vs resolved)
    [{ status: 1 }],
    [{ status: 1, subjectId: 1 }],
    // Canonical skill lookups — "which subjects have a gap for skill X?"
    [{ canonicalId: 1 }],
    // Job role analysis
    [{ jobRoleId: 1 }],
    // Time-based
    [{ identifiedAt: -1 }],
  ],
  readiness_scores: [
    // Unique per subject+role (upserted on each analysis run)
    [{ subjectType: 1, subjectId: 1, targetRole: 1 }, { unique: true, sparse: true }],
    [{ subjectType: 1, subjectId: 1 }],
    // Leaderboard / ranking queries
    [{ readinessScore: -1 }],
    [{ gapSeverity: 1 }],
    // Job role drill-down
    [{ jobRoleId: 1 }],
    // Who computed it
    [{ computedBy: 1 }],
    // Time-based
    [{ calculatedAt: -1 }],
  ],
  courses: [[{ skillIds: 1 }], [{ providerId: 1 }]],
  recommendations: [[{ recipientType: 1, recipientId: 1 }], [{ status: 1 }]],
  learning_roadmaps: [[{ studentId: 1, status: 1 }]],
  assessments: [[{ skillId: 1 }], [{ courseId: 1 }]],
  assessment_attempts: [[{ studentId: 1, completedAt: -1 }]],
  skill_demand: [[{ skillId: 1, roleId: 1 }], [{ region: 1, recordedAt: -1 }]],
  skill_trends: [[{ skillId: 1, recordedAt: -1 }]],
  regional_skill_gaps: [[{ region: 1, skillId: 1 }], [{ priority: 1 }]],
  reports: [[{ ownerId: 1, createdAt: -1 }], [{ type: 1 }]],
  government_profiles: [[{ userId: 1 }, { unique: true, sparse: true }], [{ region: 1 }]],
}

let client
let database

export async function connectToDatabase() {
  if (database) return database

  client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    maxIdleTimeMS: 300000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 5000,
  })

  await client.connect()
  database = client.db(databaseName)
  await database.command({ ping: 1 })
  await initializeDatabase()
  return database
}

async function initializeDatabase() {
  const existing = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name))

  // Drop indexes that conflict with new definitions before creating
  await dropObsoleteIndexes()

  for (const collectionName of domainCollections) {
    if (!existing.has(collectionName)) await database.createCollection(collectionName)
    for (const [keys, options] of indexes[collectionName] || []) {
      await database.collection(collectionName).createIndex(keys, options)
    }
  }
}

/**
 * Drop old index definitions that conflict with updated ones.
 * Safe to call repeatedly — ignores errors for non-existent indexes.
 */
async function dropObsoleteIndexes() {
  const drops = [
    // skill_mappings: old non-unique sourceTerm_1 replaced by unique named index
    { collection: 'skill_mappings', indexName: 'sourceTerm_1' },
    // readiness_scores: old compound index replaced by new named unique one
    { collection: 'readiness_scores', indexName: 'studentId_1_targetRole_1' },
  ]
  for (const { collection, indexName } of drops) {
    try {
      await database.collection(collection).dropIndex(indexName)
    } catch { /* index may not exist — safe to ignore */ }
  }
}

export function getDatabaseName() {
  return databaseName
}

export function getDatabase() {
  if (!database) throw new Error('MongoDB is not connected')
  return database
}

export function isDatabaseConnected() {
  return Boolean(database)
}

export async function closeDatabase() {
  if (client) await client.close()
  client = undefined
  database = undefined
}

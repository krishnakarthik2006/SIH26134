import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Search } from 'lucide-react'
import { getOccupation, searchOccupations } from '../api.js'
import './career-explorer.css'

export default function CareerExplorer() {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [results, setResults] = useState([])
  const [pagination, setPagination] = useState({ total: 0, pages: 0 })
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const data = await searchOccupations({ q: query, page, limit: 20 })
        if (active) {
          setResults(data.occupations || [])
          setPagination(data.pagination || { total: 0, pages: 0 })
          setSelected((current) => data.occupations?.some((item) => item.socCode === current?.socCode) ? current : null)
        }
      } catch {
        if (active) setError('Could not load the career library. Please try again.')
      } finally {
        if (active) setLoading(false)
      }
    }, 180)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query, page])

  const openOccupation = async (socCode) => {
    try {
      const data = await getOccupation(socCode)
      setSelected(data.occupation)
    } catch {
      setError('Could not load this occupation. Please try again.')
    }
  }

  return (
    <section className="career-explorer">
      <header className="career-heading">
        <div>
          <p className="student-kicker">CAREER REFERENCE</p>
          <h1>Career library</h1>
          <p>Explore occupations, essential skills, education, and related career paths.</p>
        </div>
        <span className="career-source">Career reference data</span>
      </header>

      <label className="career-search">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(1) }}
          placeholder="Search careers, skills, or software"
          aria-label="Search careers, skills, or software"
        />
      </label>

      {error && <p className="career-message" role="alert">{error}</p>}

      <div className="career-layout">
        <section className="career-results" aria-label="Career search results">
          <div className="career-results-heading">
            <strong>{loading ? 'Searching…' : `${pagination.total.toLocaleString()} occupations`}</strong>
            <span>Search by title, skill, or tool</span>
          </div>

          {!loading && results.length === 0 && (
            <div className="career-empty">
              <BriefcaseBusiness size={22} />
              <strong>{query ? 'No matching careers' : 'Career data is not loaded yet'}</strong>
              <span>{query ? 'Try a broader search term.' : 'Import the career data files to populate this library.'}</span>
            </div>
          )}

          {results.map((occupation) => (
            <button
              type="button"
              className={`career-result ${selected?.socCode === occupation.socCode ? 'active' : ''}`}
              key={occupation.socCode}
              onClick={() => openOccupation(occupation.socCode)}
            >
              <span className="career-result-copy">
                <strong>{occupation.title}</strong>
                <small>{occupation.socCode} · {(occupation.essentialSkills || []).length} key skills</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}

          <div className="career-pagination">
            <button type="button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>
              <ArrowLeft size={16} />
            </button>
            <span>{pagination.pages ? `${page} of ${pagination.pages}` : '0 pages'}</span>
            <button type="button" aria-label="Next page" disabled={page >= pagination.pages || loading} onClick={() => setPage((value) => value + 1)}>
              <ArrowRight size={16} />
            </button>
          </div>
        </section>

        <section className="career-detail" aria-label="Occupation details">
          {!selected ? (
            <div className="career-detail-empty">
              <BriefcaseBusiness size={24} />
              <strong>Select an occupation</strong>
              <span>Its key skills, tools, education data, and related careers will appear here.</span>
            </div>
          ) : (
            <>
              <p className="student-kicker">Occupation code {selected.socCode}</p>
              <h2>{selected.title}</h2>
              <p className="career-description">{selected.description}</p>

              <div className="career-section">
                <h3>Essential skills</h3>
                <div className="career-skill-list">
                  {(selected.essentialSkills || []).slice(0, 12).map((skill) => (
                    <div className="career-skill" key={skill.elementId}>
                      <span>{skill.name}</span>
                      <small>Importance {skill.importance ?? '—'} · Level {skill.level ?? '—'}</small>
                    </div>
                  ))}
                </div>
              </div>

              <div className="career-section">
                <h3>Software and tools</h3>
                <div className="career-tags">
                  {(selected.softwareSkills || []).filter((tool) => tool.hotTechnology || tool.inDemand).slice(0, 12).map((tool) => (
                    <span key={`${tool.name}-${tool.category}`} title={tool.category}>{tool.name}{tool.hotTechnology ? ' · Hot' : ''}</span>
                  ))}
                  {(selected.softwareSkills || []).every((tool) => !tool.hotTechnology && !tool.inDemand) && <small>No hot or in-demand tools listed.</small>}
                </div>
              </div>

              <div className="career-section">
                <h3>Education data</h3>
                <div className="career-education">
                  {(selected.education || []).filter((item) => item.scaleId === 'RL').slice(0, 8).map((item) => (
                    <div key={`${item.elementId}-${item.category}`}>
                      <span>Education category {item.category}</span>
                      <strong>{item.value ?? 0}%</strong>
                    </div>
                  ))}
                  {!(selected.education || []).some((item) => item.scaleId === 'RL') && <small>No education records listed.</small>}
                </div>
              </div>

              <div className="career-section">
                <h3>Related careers</h3>
                <div className="career-related">
                  {(selected.relatedOccupations || []).slice(0, 8).map((related) => (
                    <button type="button" key={related.socCode} onClick={() => openOccupation(related.socCode)}>
                      <span>{related.title}</span><small>{related.tier}</small>
                    </button>
                  ))}
                  {!(selected.relatedOccupations || []).length && <small>No related careers listed.</small>}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  )
}
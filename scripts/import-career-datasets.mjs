import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MongoClient } from 'mongodb'

const folderArg = process.argv.indexOf('--folder')
const dataFolder = path.resolve(folderArg >= 0 ? process.argv[folderArg + 1] : '../career_projects')
const dryRun = process.argv.includes('--dry-run')

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell.length > 0)) rows.push(row)
      row = []
      value = ''
    } else {
      value += char
    }
  }

  if (value.length || row.length) {
    row.push(value)
    rows.push(row)
  }

  const headers = rows.shift()?.map((header, index) => index === 0 ? header.replace(/^\uFEFF/, '').trim() : header.trim()) || []
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] || '').trim()])))
}

async function loadCsv(filename) {
  const filePath = path.join(dataFolder, filename)
  const rows = parseCsv(await fs.readFile(filePath, 'utf8'))
  console.log(`Read ${rows.length.toLocaleString()} rows from ${filename}`)
  return rows
}

function numeric(value) {
  if (value === '' || value == null) return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function yes(value) {
  return String(value || '').toUpperCase() === 'Y'
}

function occupationCode(row, related = false) {
  const header = Object.keys(row).find((name) => {
    const normalized = name.toLowerCase()
    return normalized.endsWith('soc code') && normalized.startsWith('related ') === related
  })
  return header ? row[header] : ''
}

function buildOccupations(occupationRows, skillRows, softwareRows, educationRows, relatedRows) {
  const occupations = new Map()

  for (const row of occupationRows) {
    const code = occupationCode(row)
    if (!code) continue
    occupations.set(code, {
      _id: code,
      socCode: code,
      title: row.Title,
      description: row.Description,
      essentialSkills: [],
      softwareSkills: [],
      education: [],
      relatedOccupations: [],
      source: 'Career reference data',
      importedAt: new Date(),
    })
  }

  const skillGroups = new Map()
  for (const row of skillRows) {
    const code = occupationCode(row)
    if (!occupations.has(code)) continue
    const elementId = row['Element ID']
    const key = `${code}\u0000${elementId}`
    const skill = skillGroups.get(key) || {
      elementId,
      name: row['Element Name'],
      importance: null,
      level: null,
    }
    const value = numeric(row['Data Value'])
    if (row['Scale ID'] === 'IM') skill.importance = value
    if (row['Scale ID'] === 'LV') skill.level = value
    skillGroups.set(key, skill)
  }
  for (const [key, skill] of skillGroups) {
    occupations.get(key.slice(0, key.indexOf('\u0000'))).essentialSkills.push(skill)
  }

  for (const row of softwareRows) {
    const occupation = occupations.get(occupationCode(row))
    if (!occupation || !row['Workplace Example']) continue
    occupation.softwareSkills.push({
      name: row['Workplace Example'],
      category: row['Element Name'],
      hotTechnology: yes(row['Hot Technology']),
      inDemand: yes(row['In Demand']),
    })
  }

  for (const row of educationRows) {
    const occupation = occupations.get(occupationCode(row))
    if (!occupation) continue
    occupation.education.push({
      elementId: row['Element ID'],
      name: row['Element Name'],
      scaleId: row['Scale ID'],
      category: row.Category,
      value: numeric(row['Data Value']),
    })
  }

  for (const row of relatedRows) {
    const occupation = occupations.get(occupationCode(row))
    if (!occupation) continue
    occupation.relatedOccupations.push({
      socCode: occupationCode(row, true),
      title: row['Related Title'],
      tier: row['Relatedness Tier'],
      rank: numeric(row.Index),
    })
  }

  for (const occupation of occupations.values()) {
    occupation.essentialSkills.sort((a, b) => (b.importance || 0) - (a.importance || 0))
  }

  return [...occupations.values()]
}

async function main() {
  console.log(`Career dataset import: ${dataFolder}${dryRun ? ' (dry run)' : ''}`)
  const [occupationRows, skillRows, softwareRows, educationRows, relatedRows] = await Promise.all([
    loadCsv('occupation_data.csv'),
    loadCsv('essential_skills.csv'),
    loadCsv('software_skills.csv'),
    loadCsv('education.csv'),
    loadCsv('related_occupations.csv'),
  ])

  const occupations = buildOccupations(occupationRows, skillRows, softwareRows, educationRows, relatedRows)
  const withSkills = occupations.filter((occupation) => occupation.essentialSkills.length > 0).length
  console.log(`Prepared ${occupations.length.toLocaleString()} occupations; ${withSkills.toLocaleString()} have essential skills.`)

  if (dryRun) {
    const sample = occupations.find((occupation) => occupation.title === 'Software Developers') || occupations[0]
    console.log(`Sample: ${sample.title} (${sample.socCode}), ${sample.essentialSkills.length} skills, ${sample.softwareSkills.length} software items, ${sample.education.length} education records, ${sample.relatedOccupations.length} related occupations.`)
    return
  }

  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017')
  try {
    await client.connect()
    const db = client.db(process.env.MONGODB_DB_NAME || 'SIH26134')
    const collection = db.collection('occupations')
    await collection.createIndex({ socCode: 1 }, { unique: true })
    await collection.createIndex({ title: 'text', description: 'text', 'essentialSkills.name': 'text', 'softwareSkills.name': 'text' }, { name: 'occupations_search' })

    const chunkSize = 250
    for (let start = 0; start < occupations.length; start += chunkSize) {
      const chunk = occupations.slice(start, start + chunkSize)
      await collection.bulkWrite(chunk.map((occupation) => ({
        replaceOne: { filter: { _id: occupation._id }, replacement: occupation, upsert: true },
      })), { ordered: false })
      console.log(`Imported ${Math.min(start + chunk.length, occupations.length).toLocaleString()} / ${occupations.length.toLocaleString()}`)
    }
    console.log(`Career dataset import complete in ${db.databaseName}.`)
  } finally {
    await client.close()
  }
}

main().catch((error) => {
  console.error(`Career dataset import failed: ${error.message}`)
  process.exitCode = 1
})
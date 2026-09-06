/**
 * AI Chat Route — Ollama-backed conversational assistant
 * Mounted at /api/ai/chat
 *
 * POST /api/ai/chat   — send a message, get a gap-closing recommendation back
 */

import { Router }       from 'express'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireAuth }  from '../middleware/auth.js'
import { env }          from '../config/env.js'

const router = Router()
router.use(requireAuth)

const AI_URL     = env.aiServiceUrl || 'http://localhost:8000'
const AI_TIMEOUT = env.aiServiceTimeout || 30000

async function callOllamaChat(messages, systemPrompt) {
  // Build prompt string from message history
  const historyText = messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n')

  const fullPrompt = historyText

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT)

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (env.aiServiceApiKey) headers['X-Api-Key'] = env.aiServiceApiKey

  try {
    const response = await fetch(`${AI_URL}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: fullPrompt, system: systemPrompt }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok) throw new Error(`AI service returned ${response.status}`)
    const data = await response.json()
    return { available: true, reply: data.reply || data.response || 'I could not generate a response. Please try again.' }
  } catch (err) {
    clearTimeout(timer)
    // Fallback: smart rule-based response when AI is busy
    return { available: false, reply: null }
  }
}

function buildFallbackReply(message, context) {
  const msg = message.toLowerCase()
  const gaps = context.gaps || []
  const targetRole = context.targetRole || 'your target role'
  const gapList = gaps.slice(0, 3).map(g => g.skillName || g).join(', ')

  if (msg.includes('gap') || msg.includes('missing') || msg.includes('need')) {
    return `Based on your profile, your top skill gaps for **${targetRole}** are: **${gapList || 'no gaps detected yet'}**. I recommend starting with the highest-priority gap and following the learning roadmap I've generated for you. Each step includes YouTube tutorials, free certifications, and project ideas to build hands-on experience.`
  }
  if (msg.includes('course') || msg.includes('learn') || msg.includes('study')) {
    return `To close your gaps for **${targetRole}**, here's my recommendation: \n\n1. 🎓 **Start with structured courses** on Coursera/edX for foundational skills\n2. ▶️ **YouTube tutorials** for quick practical demos\n3. 📜 **Free certifications** from Google, AWS, or freeCodeCamp\n4. 💻 **Build a project** to apply what you learn\n\nHead to the **Recommendations** tab for a ranked list personalised to your exact gaps.`
  }
  if (msg.includes('roadmap') || msg.includes('plan') || msg.includes('path')) {
    return `Your personalised learning roadmap is generated directly from your skill gaps vs the **${targetRole}** requirements. Go to **Learning roadmap** tab to see it step-by-step. Each step is ordered so you build foundational skills first, then advanced ones. You can mark steps complete as you go!`
  }
  if (msg.includes('job') || msg.includes('ready') || msg.includes('readiness')) {
    return `Your job readiness score reflects how well your current skills match **${targetRole}** requirements. To improve it: (1) add more skills to your profile, (2) upload your resume so I can extract skills automatically, and (3) complete the steps in your learning roadmap. Each skill you close increases your score!`
  }
  if (msg.includes('certif')) {
    return `For **${targetRole}**, I recommend these free certifications: Google Certificates (Coursera), AWS Free Tier, freeCodeCamp, Microsoft Learn, and Kaggle Learn. These are industry-recognized, free, and directly tied to the skills employers are demanding. Check your **Recommendations** tab for ones matched to your specific gaps.`
  }
  if (msg.includes('youtube') || msg.includes('video')) {
    return `YouTube is one of the best free resources to close skill gaps fast. In your **Learning Roadmap**, each step already includes curated YouTube search links for your specific missing skills: **${gapList || 'skills in your profile'}**. Click any step to see the resources!`
  }
  if (msg.includes('project') || msg.includes('portfolio')) {
    return `Building projects is the fastest way to prove your skills to employers. For **${targetRole}**, try: (1) a portfolio project on GitHub for each missing skill, (2) contribute to open-source projects, (3) build something that combines your gap skills. Your roadmap links to relevant GitHub topics for each gap!`
  }
  return `I'm your AI career advisor for closing skill gaps and reaching **${targetRole}**. Ask me about: your skill gaps, recommended courses, certifications, YouTube resources, your learning roadmap, or job readiness. How can I help you grow today?`
}

/**
 * POST /api/ai/chat
 * Body: { message: string, history?: [{role,content}], context?: { gaps, targetRole, currentSkills } }
 */
router.post('/', asyncHandler(async (req, res) => {
  const { message, history = [], context = {} } = req.body

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required' })
  }

  const systemPrompt = `You are SkillSync's Ollama-powered AI career advisor. Your role is to help learners close their skill gaps and reach their target job roles.

Context about this learner:
- Target role: ${context.targetRole || 'not set'}
- Skill gaps: ${(context.gaps || []).map(g => g.skillName || g).join(', ') || 'none identified yet'}
- Current skills: ${(context.currentSkills || []).map(s => s.skillName || s).join(', ') || 'not specified'}
- Job readiness score: ${context.readinessScore || 'unknown'}

You help learners by:
1. Explaining which skills to learn and why
2. Recommending specific courses, YouTube channels, free certifications
3. Suggesting hands-on projects to build their portfolio
4. Creating personalised learning plans
5. Explaining how to interpret their skill gap analysis

Be concise, practical, and encouraging. Use markdown for formatting. Focus on actionable advice.`

  const messages = [
    ...history.slice(-6), // keep last 6 turns for context
    { role: 'user', content: message.trim() },
  ]

  const aiResult = await callOllamaChat(messages, systemPrompt)

  let reply
  if (aiResult.available && aiResult.reply) {
    reply = aiResult.reply
  } else {
    // Intelligent fallback when AI service is unavailable
    reply = buildFallbackReply(message, context)
  }

  res.json({ reply, engine: aiResult.available ? 'ollama' : 'rule-based' })
}))

export default router

import nspell from 'nspell'

export type SpellingIssue = {
  word: string
  suggestions: string[]
}

type Spellchecker = ReturnType<typeof nspell>

let spellPromise: Promise<Spellchecker> | null = null

/** Frequent typos hunspell often ranks poorly (e.g. teh → the). */
const COMMON_TYPOS: Record<string, string[]> = {
  teh: ['the'],
  adn: ['and'],
  taht: ['that'],
  whihc: ['which'],
  wierd: ['weird'],
  recieve: ['receive'],
  beleive: ['believe'],
  becuase: ['because'],
  becasue: ['because'],
  definately: ['definitely'],
  seperate: ['separate'],
  occured: ['occurred'],
  untill: ['until'],
  tommorow: ['tomorrow'],
  tommorrow: ['tomorrow'],
  enviroment: ['environment'],
  accomodate: ['accommodate'],
  adress: ['address'],
  begining: ['beginning'],
  buisness: ['business'],
  calender: ['calendar'],
  comming: ['coming'],
  copywrite: ['copyright'],
  finaly: ['finally'],
  fourty: ['forty'],
  freind: ['friend'],
  govenment: ['government'],
  grammer: ['grammar'],
  happend: ['happened'],
  independant: ['independent'],
  knowlege: ['knowledge'],
  libary: ['library'],
  litle: ['little'],
  mispell: ['misspell'],
  neccessary: ['necessary'],
  ocassion: ['occasion'],
  publically: ['publicly'],
  realy: ['really'],
  refered: ['referred'],
  rember: ['remember'],
  speach: ['speech'],
  sucess: ['success'],
  thier: ['their'],
  truely: ['truly'],
  usefull: ['useful'],
  writting: ['writing'],
  writen: ['written'],
}

const IGNORE = new Set([
  'printx',
  'dfw',
  'pla',
  'petg',
  'stl',
  'gcode',
  'fdm',
  'sla',
  'resend',
  'supabase',
])

function loadSpellchecker(): Promise<Spellchecker> {
  if (!spellPromise) {
    spellPromise = (async () => {
      const [aff, dic] = await Promise.all([
        fetch('/spell/en.aff').then((r) => {
          if (!r.ok) throw new Error('Missing English affix dictionary')
          return r.text()
        }),
        fetch('/spell/en.dic').then((r) => {
          if (!r.ok) throw new Error('Missing English word dictionary')
          return r.text()
        }),
      ])
      const spell = nspell(aff, dic)
      for (const word of IGNORE) spell.add(word)
      spell.add('PrintX')
      return spell
    })().catch((err) => {
      spellPromise = null
      throw err
    })
  }
  return spellPromise
}

function shouldSkip(word: string) {
  if (word.length < 3) return true
  if (IGNORE.has(word.toLowerCase())) return true
  if (/^\d+$/.test(word)) return true
  if (/@|\./.test(word)) return true
  if (/^[A-Z0-9]{2,}$/.test(word)) return true
  return false
}

function unique(words: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words) {
    const key = w.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(w)
  }
  return out
}

export async function findSpellingIssues(text: string, limit = 6): Promise<SpellingIssue[]> {
  const trimmed = text.trim()
  if (!trimmed) return []

  let spell: Spellchecker
  try {
    spell = await loadSpellchecker()
  } catch {
    return []
  }

  const words = trimmed.match(/[A-Za-z']+/g) ?? []
  const seen = new Set<string>()
  const issues: SpellingIssue[] = []

  for (const raw of words) {
    const word = raw.replace(/^'+|'+$/g, '')
    if (!word || shouldSkip(word)) continue
    const key = word.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    if (spell.correct(word) || spell.correct(key)) continue

    const common = COMMON_TYPOS[key] ?? []
    const fromDict = spell.suggest(word).slice(0, 5)
    const suggestions = unique([...common, ...fromDict]).slice(0, 3)
    if (suggestions.length === 0) continue

    issues.push({ word, suggestions })
    if (issues.length >= limit) break
  }

  return issues
}

/** Replace the first whole-word match, keeping the original capitalization pattern when possible. */
export function applySpellingFix(text: string, word: string, replacement: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\b${escaped}\\b`)
  return text.replace(re, (match) => {
    if (match === match.toUpperCase() && match.length > 1) return replacement.toUpperCase()
    if (match[0] === match[0]?.toUpperCase()) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1)
    }
    return replacement
  })
}

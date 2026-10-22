// Auto-calculate the quantity to dispense from strength, dose, frequency and duration.
// Returns { qty, note } or null when it cannot be worked out (user then types quantity).

const MASS = { mcg: 0.001, µg: 0.001, ug: 0.001, mg: 1, g: 1000, gm: 1000, gms: 1000 }

function strengthsMg(strength) {
  if (!strength || strength.includes('/')) return [] // e.g. 120mg/5ml: not a per-unit strength
  const out = []
  const re = /(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|gms|gm|g)\b/gi
  let m
  while ((m = re.exec(strength))) out.push(parseFloat(m[1]) * MASS[m[2].toLowerCase()])
  return out
}

function perDoseUnits(dose, strength) {
  const d = (dose || '').trim().toLowerCase()
  if (!d) return null
  const mass = d.match(/^(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|gms|gm|g)\b/)
  if (mass) {
    const mg = parseFloat(mass[1]) * MASS[mass[2]]
    const opts = strengthsMg(strength)
    if (!opts.length) return null
    // prefer the strength that divides the dose evenly (largest first), else the first listed
    const even = opts.filter((s) => (mg / s) % 0.5 === 0).sort((a, b) => b - a)[0]
    const s = even || opts[0]
    return { units: Math.ceil((mg / s) * 2) / 2, text: `${mg / s <= 0 ? '' : Math.ceil((mg / s) * 2) / 2} × ${s}mg` }
  }
  const count = d.match(/^(\d+(?:\.\d+)?|½|half)\s*(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|amp|ampoule|ampoules|vial|vials|sachet|sachets|puff|puffs|unit|units)?\.?$/)
  if (count) {
    const n = count[1] === '½' || count[1] === 'half' ? 0.5 : parseFloat(count[1])
    return { units: n, text: `${n}` }
  }
  return null
}

function timesPerDay(freq) {
  const f = (freq || '').toLowerCase()
  const every = f.match(/(?:every|q)\s*(\d+)\s*(?:h|hr|hrs|hour|hours)?/)
  if (every && +every[1] > 0 && +every[1] <= 24) return 24 / +every[1]
  if (/\b(od|once|nocte|nightly|mane|daily \(od\)|at night)\b/.test(f)) return 1
  if (/\b(bd|bid|twice)\b/.test(f)) return 2
  if (/\b(tds|tid|thrice|three)\b/.test(f)) return 3
  if (/\b(qid|qds|four)\b/.test(f)) return 4
  if (/\b(stat|single|once)\b/.test(f)) return 1
  return null
}

function days(duration) {
  const m = (duration || '').toLowerCase().match(/(\d+(?:\.\d+)?)\s*(d|day|days|w|wk|wks|week|weeks|m|month|months)\b/)
  if (!m) return null
  const n = parseFloat(m[1]), u = m[2]
  return u.startsWith('d') ? n : u.startsWith('w') ? n * 7 : n * 30
}

export function autoQuantity({ dose, frequency, duration }, strength) {
  const per = perDoseUnits(dose, strength)
  const t = timesPerDay(frequency)
  const d = days(duration)
  if (!per || !t || !d) return null
  const qty = Math.ceil(per.units * t * d)
  return { qty, note: `${per.units} per dose × ${t}/day × ${d} day${d === 1 ? '' : 's'} = ${qty}` }
}

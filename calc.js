// Quantity is always calculated by the system from strength, dose, frequency and duration.

export const FREQUENCIES = [
  { label: 'Once daily (OD)', perDay: 1 },
  { label: 'Twice daily (BD)', perDay: 2 },
  { label: 'Three times daily (TDS)', perDay: 3 },
  { label: 'Four times daily (QID)', perDay: 4 },
  { label: 'At night (Nocte)', perDay: 1 },
  { label: 'Every 4 hours', perDay: 6 },
  { label: 'Every 6 hours', perDay: 4 },
  { label: 'Every 8 hours', perDay: 3 },
  { label: 'Every 12 hours', perDay: 2 },
  { label: 'Single dose (STAT)', perDay: 1, single: true },
]
export const DOSE_UNITS = [
  { value: 'mg', label: 'mg' },
  { value: 'g', label: 'g' },
  { value: 'mcg', label: 'mcg' },
  { value: 'ml', label: 'ml' },
  { value: 'unit', label: 'tab / unit' },
]
export const DURATION_UNITS = [
  { value: 'days', label: 'days', mult: 1 },
  { value: 'weeks', label: 'weeks', mult: 7 },
  { value: 'months', label: 'months', mult: 30 },
]

const MG = { mcg: 0.001, µg: 0.001, ug: 0.001, mg: 1, g: 1000, gm: 1000, gms: 1000 }

// What does the strength text tell us?
//  { kind:'unit', mg:[...], word }  e.g. "Tablet 500mg"   -> each tablet has 500 mg
//  { kind:'conc', mgPerMl }          e.g. "Injection 3mg/mL", "Suspension 120mg/5ml"
//  { kind:'none', word }             no usable number     -> dose is entered as tablets/units
export function parseStrength(strength) {
  const s = strength || ''
  const word = (s.match(/\b(tablet|capsule|ampoule|vial|sachet|suppository|pessary|cream|ointment|injection|syrup|suspension|solution|drops|elixir|mixture|emulsion|inhaler)/i)?.[1] || '').toLowerCase()
  const conc = s.match(/(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|g)\s*\/\s*(\d+(?:\.\d+)?)?\s*(ml|l)\b/i)
  if (conc) {
    let ml = parseFloat(conc[3] || '1'); if (conc[4].toLowerCase() === 'l') ml *= 1000
    return { kind: 'conc', mgPerMl: (parseFloat(conc[1]) * MG[conc[2].toLowerCase()]) / ml, word }
  }
  if (!s.includes('/')) {
    const re = /(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|gms|gm|g)\b/gi
    const mg = []; let m
    while ((m = re.exec(s))) mg.push(parseFloat(m[1]) * MG[m[2].toLowerCase()])
    if (mg.length) return { kind: 'unit', mg, word, firstUnit: s.match(/\d\s*(mcg|µg|ug|mg|gms|gm|g)\b/i)[1].toLowerCase() }
  }
  return { kind: 'none', word }
}

// unit pre-selected in the dose box once a medicine is chosen (user can change it)
export function defaultDoseUnit(strength) {
  const p = parseStrength(strength)
  if (p.kind === 'unit') return p.firstUnit.startsWith('g') ? 'g' : p.firstUnit === 'mcg' || p.firstUnit === 'µg' || p.firstUnit === 'ug' ? 'mcg' : 'mg'
  if (p.kind === 'conc') return 'ml'
  return 'unit'
}

const LIQUIDS = ['syrup', 'suspension', 'solution', 'drops', 'elixir', 'mixture', 'emulsion']
const plural = (w, n) => (n === 1 || w === 'ml' || w.endsWith('s') ? w : w + 's')

// returns { qty, unitLabel, note } or { error } or null (still incomplete)
export const isLiquid = (strength) => LIQUIDS.includes(parseStrength(strength).word)

export function autoQuantity({ doseNum, doseUnit, frequency, durNum, durUnit, liquid }, strength) {
  const n = parseFloat(doseNum), dn = parseFloat(durNum)
  const f = FREQUENCIES.find((x) => x.label === frequency)
  const du = DURATION_UNITS.find((x) => x.value === durUnit)
  if (!(n > 0) || !f || !du || (!f.single && !(dn > 0))) return null
  const days = f.single ? 1 : dn * du.mult
  const p = parseStrength(strength)
  const word = p.word || 'unit'
  // ticked "syrup / liquid": dispensed as one bottle, whatever the course length
  if (liquid) {
    let note = `1 bottle (${n} ${doseUnit === 'unit' ? 'unit' : doseUnit} × ${f.perDay}/day × ${days} day${days === 1 ? '' : 's'})`
    if (doseUnit === 'ml') note = `1 bottle (${n} ml × ${f.perDay}/day × ${days} day${days === 1 ? '' : 's'} = ${+(n * f.perDay * days).toFixed(1)} ml needed)`
    return { qty: 1, unitLabel: 'bottle', note }
  }
  let per, unitLabel, desc
  if (doseUnit === 'unit') {
    per = n; unitLabel = word; desc = `${n} ${plural(word, n)}`
  } else if (doseUnit === 'ml') {
    if (p.kind !== 'conc') return { error: 'This medicine is not a liquid with mg/ml strength – choose mg or tab/unit.' }
    per = n; unitLabel = 'ml'; desc = `${n} ml`
  } else {
    const mg = n * MG[doseUnit]
    if (p.kind === 'unit') {
      const even = p.mg.filter((s) => (mg / s) % 0.5 === 0).sort((a, b) => b - a)[0]
      const s = even || p.mg[0]
      per = Math.ceil((mg / s) * 2) / 2; unitLabel = word; desc = `${per} ${plural(word, per)} (${mg}mg ÷ ${s}mg)`
    } else if (p.kind === 'conc') {
      per = mg / p.mgPerMl; unitLabel = 'ml'; desc = `${+per.toFixed(2)} ml (${mg}mg ÷ ${+p.mgPerMl.toFixed(2)}mg/ml)`
    } else return { error: 'No strength recorded for this medicine – choose "tab / unit" or ask the admin to add the strength.' }
  }
  const qty = Math.ceil(per * f.perDay * days - 1e-9)
  return { qty, unitLabel, note: `${desc} × ${f.perDay}/day × ${days} day${days === 1 ? '' : 's'} = ${qty} ${plural(unitLabel, qty)}` }
}

/**
 * Adjusts formulas when rows are inserted or deleted, the way Excel does: references below the
 * change move with their rows, ranges grow or shrink, and a single cell that was deleted becomes
 * #REF!. Text inside double quotes is left alone.
 */

export interface RowChange {
  /** The sheet whose rows moved. */
  sheet: string
  /** First row inserted or deleted (1-based). */
  at: number
  /** Rows inserted (positive) or deleted (negative). */
  delta: number
}

// An optional sheet ('My sheet'! or Sheet1!), then a cell (A1, $A$1) optionally followed by :cell.
const reference =
  /((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![\w(])/g

function unquote(sheet: string): string {
  const name = sheet.slice(0, -1)
  return name.startsWith('\'') ? name.slice(1, -1).replace(/''/g, '\'') : name
}

/** Where a row ends up, or null when it was deleted. */
function movedRow(row: number, change: RowChange): number | null {
  if (change.delta > 0) return row >= change.at ? row + change.delta : row
  const last = change.at - change.delta - 1
  if (row < change.at) return row
  if (row > last) return row + change.delta
  return null
}

/**
 * Rewrites one formula (without the leading "="). `formulaSheet` is the sheet the formula is on;
 * unqualified references belong to it.
 */
export function shiftFormula(formula: string, formulaSheet: string, change: RowChange): string {
  // Split off string literals so a quoted "A1" is never touched.
  return formula
    .split(/("(?:[^"]|"")*")/)
    .map((part, index) => index % 2 === 1 ? part : shiftReferences(part, formulaSheet, change))
    .join('')
}

function shiftReferences(text: string, formulaSheet: string, change: RowChange): string {
  return text.replace(
    reference,
    (
      match,
      sheet: string | undefined,
      colAbs1: string,
      col1: string,
      rowAbs1: string,
      row1: string,
      colAbs2?: string,
      col2?: string,
      rowAbs2?: string,
      row2?: string,
    ) => {
      const target = sheet ? unquote(sheet) : formulaSheet
      if (target !== change.sheet) return match
      const prefix = sheet ?? ''
      const first = Number(row1)
      if (row2 === undefined || col2 === undefined) {
        const moved = movedRow(first, change)
        return moved === null ? '#REF!' : `${prefix}${colAbs1}${col1}${rowAbs1}${moved}`
      }
      const second = Number(row2)
      let top = movedRow(first, change)
      let bottom = movedRow(second, change)
      if (change.delta < 0) {
        const last = change.at - change.delta - 1
        // A range keeps the rows that survive; it is lost only when every row was deleted.
        if (top === null) top = change.at
        if (bottom === null) bottom = change.at - 1
        if (first >= change.at && second <= last) return '#REF!'
      }
      return `${prefix}${colAbs1}${col1}${rowAbs1}${top}:${colAbs2}${col2}${rowAbs2}${bottom}`
    },
  )
}

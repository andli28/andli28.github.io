import { createContentLoader } from 'vitepress'

export interface Post {
  title: string
  url: string
  date: string
  dateLabel: string
}

function asTime(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value)
  return Number.NaN
}

function asIsoDate(value: unknown): string {
  const time = asTime(value)
  if (Number.isNaN(time)) return ''
  return new Date(time).toISOString().slice(0, 10)
}

function asLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default createContentLoader('blog/*.md', {
  transform(pages): Post[] {
    return pages
      .flatMap((page) => {
        const date = asIsoDate(page.frontmatter.date)
        const title = page.frontmatter.title
        if (!date || typeof title !== 'string') return []
        return [
          {
            title,
            url: page.url,
            date,
            dateLabel: asLabel(date),
          },
        ]
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1))
  },
})

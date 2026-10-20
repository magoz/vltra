import { describe, expect, it } from 'vitest'
import { Option } from 'effect'
import { failureMessage, mergedQuery, parseSearchPage } from '@/lib/services/github/search'

const window = { from: Date.UTC(2026, 9, 20, 12), to: Date.UTC(2026, 9, 20, 13) }

const node = (number: number, mergedAt: string | null) => ({
  number,
  createdAt: '2026-10-20T11:00:00Z',
  mergedAt,
  repository: { nameWithOwner: 'magoz/vltra' }
})

const answer = (nodes: ReadonlyArray<ReturnType<typeof node>>, endCursor: string | null) =>
  JSON.stringify({
    data: {
      search: {
        issueCount: 1234,
        pageInfo: { hasNextPage: endCursor !== null, endCursor },
        nodes
      }
    }
  })

describe('GitHub search', () => {
  it('asks for the user’s merged PRs to the second before the end', () => {
    expect(mergedQuery(window)).toBe(
      'is:pr author:@me is:merged merged:2026-10-20T12:00:00Z..2026-10-20T12:59:59Z'
    )
  })

  it('reads a page: the count, the next cursor and the pulls inside the window', () => {
    const page = parseSearchPage(
      answer(
        [
          node(1, '2026-10-20T12:30:00Z'),
          // The search includes the end's second; the window does not.
          node(2, '2026-10-20T13:00:00Z'),
          node(3, null)
        ],
        'Y3Vyc29yOjI='
      ),
      window
    )

    expect(page).toEqual(
      Option.some({
        count: 1234,
        next: 'Y3Vyc29yOjI=',
        pulls: [
          {
            repo: 'magoz/vltra',
            number: 1,
            createdAt: Date.UTC(2026, 9, 20, 11),
            mergedAt: Date.UTC(2026, 9, 20, 12, 30)
          }
        ]
      })
    )

    expect(Option.map(parseSearchPage(answer([], null), window), value => value.next)).toEqual(
      Option.some(undefined)
    )

    expect(parseSearchPage('{"data":null}', window)).toEqual(Option.none())
  })

  it('says why gh failed', () => {
    expect(failureMessage(4, '')).toBe('gh is not signed in')
    expect(failureMessage(1, '{"message":"Bad credentials","status":"401"}')).toBe(
      'GitHub: Bad credentials'
    )
    expect(failureMessage(1, 'oops')).toBe('gh api failed (exit 1)')
  })
})

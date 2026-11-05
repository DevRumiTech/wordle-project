import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { gameApi } from '../api/games'

const PAGE_SIZE = 20

const Results = styled.details`
  width: 100%;
  padding: 1rem;
  border: 1px solid #77828c;
  border-radius: 8px;
  text-align: left;
  box-sizing: border-box;

  summary {
    cursor: pointer;
    font-weight: 700;
  }
`

const Statistics = styled.dl`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
  gap: 0.75rem;

  dt { font-size: 0.85rem; }
  dd { margin: 0; font-weight: 700; }
`

const TableContainer = styled.div`
  overflow-x: auto;

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th, td {
    padding: 0.5rem;
    text-align: left;
    border-bottom: 1px solid #77828c;
  }
`

function displayDate(value) {
  // Handle invalid dates without crashing the React component.
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : date.toLocaleString()
}

export default function GameHistory({ refreshKey }) {
  const [stats, setStats] = useState(null)
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true

    // Read the current user's results from the existing API.
    Promise.all([
      gameApi.getStats(),
      gameApi.getHistory(PAGE_SIZE, 0),
    ]).then(([summary, history]) => {
      if (!current) return
      if (!Array.isArray(history.games)) {
        throw new Error('Invalid history response.')
      }

      setStats(summary)
      setGames(history.games)
      setHasMore(history.games.length === PAGE_SIZE)
      setError('')
    }).catch(failure => {
      if (current) setError(failure.message)
    }).finally(() => {
      if (current) setLoading(false)
    })

    // Ignore responses after the component or request changes.
    return () => { current = false }
  }, [refreshKey])

  async function loadMore() {
    if (loadingMore || !hasMore) return

    setLoadingMore(true)
    setError('')

    try {
      // The offset skips games already displayed.
      const history = await gameApi.getHistory(PAGE_SIZE, games.length)

      if (!Array.isArray(history.games)) {
        throw new Error('Invalid history response.')
      }

      setGames(previous => [...previous, ...history.games])
      setHasMore(history.games.length === PAGE_SIZE)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <Results>
      <summary>Personal statistics and game history</summary>

      {loading && <p role="status">Loading results...</p>}
      {error && <p role="alert">{error}</p>}

      {stats && (
        <>
          <h3>Personal statistics</h3>
          <Statistics>
            {[
              ['Completed games', stats.totalGames],
              ['Victories', stats.wins],
              ['Defeats', stats.losses],
              ['Win rate', `${stats.winRate}%`],
              ['Total score', stats.totalScore],
              ['Average attempts on wins', stats.averageWinAttempts],
              ['Best winning streak', stats.longestWinStreak],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </Statistics>
        </>
      )}

      <h3>Game history</h3>

      {!loading && games.length === 0 && (
        <p>No completed games yet.</p>
      )}

      {games.length > 0 && (
        <TableContainer>
          <table>
            <caption>Completed Wordle games</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Language</th>
                <th scope="col">Result</th>
                <th scope="col">Attempts</th>
                <th scope="col">Score</th>
              </tr>
            </thead>
            <tbody>
              {games.map(game => (
                <tr key={game.id}>
                  <td>{displayDate(game.finished_at)}</td>
                  <td>{game.language === 'fr' ? 'French' : 'English'}</td>
                  <td>{game.status === 'won' ? 'Won' : 'Lost'}</td>
                  <td>{game.attempts_used}</td>
                  <td>{game.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableContainer>
      )}

      {hasMore && (
        <button type="button" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? 'Loading...' : 'Load older games'}
        </button>
      )}
    </Results>
  )
}
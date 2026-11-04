import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { gameApi } from '../api/games'
import {
  MAX_GUESSES,
  addLetter,
  removeLetter,
  keyboardStatuses,
} from './logic'

// Wordle colors with text labels for accessibility.
const colors = {
  correct: '#286b3c',
  present: '#806000',
  absent: '#53606b',
}

const Panel = styled.section`
  display: grid;
  gap: 1rem;
  width: 100%;
  max-width: 680px;
  margin: 1rem auto;
  text-align: center;
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.75rem;

  select, button {
    min-height: 44px;
    padding: 0.65rem 1rem;
    border: 1px solid #657180;
    border-radius: 7px;
    font: inherit;
  }

  button {
    background: #286b3c;
    color: white;
    cursor: pointer;
  }

  :is(select, button):focus-visible {
    outline: 3px solid #509aef;
    outline-offset: 3px;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`

const Board = styled.div`
  display: grid;
  grid-template-rows: repeat(6, auto);
  gap: 0.35rem;
  width: min(100%, 375px);
  margin: 0 auto;
`

const BoardRow = styled.div`
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.35rem;
`

const Tile = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: clamp(44px, 10vw, 57px);
  border: 2px solid
    ${({ $feedback }) => $feedback ? colors[$feedback] : '#77828c'};
  border-radius: 4px;
  background: ${({ $feedback }) =>
    $feedback ? colors[$feedback] : 'transparent'};
  color: ${({ $feedback }) => $feedback ? '#ffffff' : 'inherit'};
  font-size: clamp(1.25rem, 5vw, 1.8rem);
  font-weight: 700;
  text-transform: uppercase;
`

const SubmitButton = styled.button`
  min-height: 44px;
  padding: 12px 24px;
  border: 0;
  border-radius: 7px;
  background: #286b3c;
  color: white;
  font: inherit;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 3px solid #509aef;
    outline-offset: 3px;
  }
`
const Keyboard = styled.div`
  display: grid;
  gap: 0.35rem;
  width: min(100%, 530px);
  margin: 0 auto;
`

const KeyRow = styled.div`
  display: flex;
  justify-content: center;
  gap: 0.25rem;
`

const Key = styled.button`
  flex: ${({ $wide }) => $wide ? '1.5' : '1'};
  min-width: 0;
  max-width: ${({ $wide }) => $wide ? '85px' : '52px'};
  min-height: 45px;
  padding: 0.25rem 0;
  border: 1px solid #69737d;
  border-radius: 5px;
  background: ${({ $feedback }) =>
    colors[$feedback] ?? '#e1e5e8'};
  color: ${({ $feedback }) => $feedback ? '#ffffff' : '#17212b'};
  font-size: ${({ $wide }) => $wide ? '0.7rem' : '0.9rem'};
  font-weight: 700;
  cursor: pointer;

  &:focus-visible {
    outline: 3px solid #509aef;
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

const Message = styled.p`
  margin: 0;
  min-height: 1.5rem;
`

const keyboardRows = [
  [...'QWERTYUIOP'],
  [...'ASDFGHJKL'],
  ['ENTER', ...'ZXCVBNM', 'BACKSPACE'],
]

export default function WordleGame() {
  const [language, setLanguage] = useState('en')
  const [game, setGame] = useState(null)
  const [guesses, setGuesses] = useState([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState(
    'Choose a language and start a game.'
  )

  // Prevent duplicate submissions before React updates the screen.
  const busy = useRef(false)
  const active = game?.status === 'in_progress'
  const keyStatuses = keyboardStatuses(guesses)

  async function startGame() {
    if (busy.current || active) return

    busy.current = true
    setPending(true)
    setError('')

    try {
      // Express chooses the secret and stores it in MySQL.
      const created = await gameApi.createGame(language)

      if (!created.gameId || created.status !== 'in_progress') {
        throw new Error('Invalid new-game response.')
      }

      setGame(created)
      setGuesses([])
      setDraft('')
      setMessage('Game started. Enter a five-letter word.')
    } catch (failure) {
      setError(failure.message)
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  const submitGuess = useCallback(async () => {
    if (!active || busy.current || draft.length !== 5) return

    busy.current = true
    setPending(true)
    setError('')

    try {
      // The backend validates the dictionary and calculates feedback.
      const result = await gameApi.submitGuess(game.gameId, draft)

      if (!Array.isArray(result.feedback) ||
          result.feedback.length !== 5 ||
          !['in_progress', 'won', 'lost'].includes(result.status)) {
        throw new Error('Invalid guess response.')
      }

      setGuesses(previous => [
        ...previous,
        { word: draft, feedback: result.feedback },
      ])

      setGame(previous => ({
        ...previous,
        status: result.status,
        attemptsRemaining: result.attemptsRemaining,
        score: result.score,
        solution: result.solution,
      }))

      setDraft('')

      if (result.status === 'won') {
        setMessage(`You won! Score: ${result.score}`)
      } else if (result.status === 'lost') {
        setMessage(`Game over. The word was ${result.solution}.`)
      } else {
        setMessage(
          `${result.attemptsRemaining} attempts remaining.`
        )
      }
    } catch (failure) {
      // Keep the entered word so the player can correct it.
      setError(failure.message)
    } finally {
      busy.current = false
      setPending(false)
    }
  }, [active, draft, game])

  const pressKey = useCallback((key) => {
    if (key === 'ENTER') {
      void submitGuess()
      return
    }

    if (!active || busy.current) return

    if (key === 'BACKSPACE') {
      setDraft(previous => removeLetter(previous))
    } else {
      setDraft(previous => addLetter(previous, key))
    }
  }, [active, submitGuess])

  // Physical keyboard and virtual keyboard use the same rules.
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return

      // Do not interfere with buttons, forms or editable elements.
      if (event.target?.closest?.(
        'input, select, textarea, button, [contenteditable="true"]'
      )) return

      const key = event.key.toUpperCase()
      if (key === 'ENTER' || key === 'BACKSPACE' ||
          /^[A-ZÀ-ÿ]$/i.test(event.key)) {
        event.preventDefault()
        pressKey(key)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener(
      'keydown', handleKeyDown
    )
  }, [pressKey])

  return (
    <Panel aria-label="Wordle game">
      <Controls>
        <label htmlFor="game-language">Language</label>
        <select
          id="game-language"
          value={language}
          disabled={pending || active}
          onChange={event => setLanguage(event.target.value)}
        >
          <option value="en">English</option>
          <option value="fr">French</option>
        </select>

        <button
          type="button"
          onClick={startGame}
          disabled={pending || active}
        >
          {game ? 'New game' : 'Start game'}
        </button>
      </Controls>

      <Message role="status" aria-live="polite">
        {message}
      </Message>

      {error && <p role="alert">{error}</p>}

      <Board role="grid" aria-label="Six rows of five letters">
        {Array.from({ length: MAX_GUESSES }, (_, row) => {
          const previous = guesses[row]
          const letters = previous?.word ??
            (row === guesses.length && active ? draft : '')

          return (
            <BoardRow role="row" key={row}>
              {Array.from({ length: 5 }, (_, column) => {
                const letter = letters[column] ?? ''
                const feedback = previous?.feedback[column]

                return (
                  <Tile
                    key={column}
                    role="gridcell"
                    $feedback={feedback}
                    aria-label={
                      `Row ${row + 1}, column ${column + 1}: ` +
                      `${letter || 'empty'}` +
                      (feedback ? `, ${feedback}` : '')
                    }
                  >
                    {letter}
                  </Tile>
                )
              })}
            </BoardRow>
          )
        })}
      </Board>

      {/* Submit only when five letters are ready. */}
      <SubmitButton
        type="button"
        onClick={() => void submitGuess()}
        disabled={!active || pending || draft.length !== 5}
      >
        Submit guess
      </SubmitButton>
      <Keyboard aria-label="On-screen keyboard">
        {keyboardRows.map((row, index) => (
          <KeyRow key={index}>
            {row.map(key => (
              <Key
                type="button"
                key={key}
                $wide={key.length > 1}
                $feedback={keyStatuses[key]}
                disabled={!active || pending}
                onClick={() => pressKey(key)}
                aria-label={
                  key === 'ENTER' ? 'Submit guess' :
                  key === 'BACKSPACE' ? 'Delete last letter' :
                  `Letter ${key}`
                }
              >
                {key === 'BACKSPACE' ? 'DEL' : key}
              </Key>
            ))}
          </KeyRow>
        ))}
      </Keyboard>

      {active && (
        <p>
          Guess {guesses.length + 1} of {MAX_GUESSES}
          {draft.length !== 5 && '. Enter five letters.'}
        </p>
      )}

      {game?.status === 'won' && (
        <p role="status">Victory. You can start another game.</p>
      )}
      {game?.status === 'lost' && (
        <p role="status">You can start another game.</p>
      )}
    </Panel>
  )
}
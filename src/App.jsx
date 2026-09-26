import './App.css'
import { usePlanTrip, STATUS } from './hooks/usePlanTrip.js'
import TripForm from './components/TripForm.jsx'
import TripResult from './components/TripResult.jsx'
import Error from './components/Error.jsx'

function App() {
  const { status, trip, partial, error, run, reset, cancel } = usePlanTrip()
  const streaming = status === STATUS.LOADING

  const done = partial?.days.length ?? 0
  const total = partial?.durationDays ?? 0
  const progress = done === 0
    ? 'Planning your trip…'
    : total > 0
      ? `Day ${done} of ${total} planned`
      : `Day ${done} planned`

  return (
    <div className="app">
      <header className="app-header">
        <h1>Travel Planner</h1>
        <p>Describe a trip in your own words — get a structured, day-by-day itinerary.</p>
      </header>

      <main className="app-main">
        <TripForm onSubmit={run} busy={streaming} />

        {status === STATUS.IDLE && <p className="empty-state">Describe a trip to get a day-by-day plan.</p>}

        {streaming && (
          <>
            <TripResult trip={partial} streaming />
            <div className="planning-bar">
              <p className="loading-hint">{progress}</p>
              <button type="button" className="cancel-btn" onClick={cancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {status === STATUS.ERROR && <Error message={error?.message} />}

        {status === STATUS.SUCCESS && trip && (
          <>
            <TripResult trip={trip} />
            <button type="button" className="reset-btn" onClick={reset}>
              Plan a different trip
            </button>
          </>
        )}
      </main>
    </div>
  )
}

export default App

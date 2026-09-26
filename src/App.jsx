import './App.css'
import { usePlanTrip, STATUS } from './hooks/usePlanTrip.js'
import TripForm from './components/TripForm.jsx'
import TripResult from './components/TripResult.jsx'
import Error from './components/Error.jsx'

function App() {
  const { status, trip, error, run, reset } = usePlanTrip()

  return (
    <div className="app">
      <header className="app-header">
        <h1>Travel Planner</h1>
        <p>Describe a trip in your own words — get a structured, day-by-day itinerary.</p>
      </header>

      <main className="app-main">
        <TripForm onSubmit={run} busy={status === STATUS.LOADING} />

        {status === STATUS.IDLE && <p className="empty-state">Describe a trip to get a day-by-day plan.</p>}

        {status === STATUS.LOADING && <p className="loading-hint">Planning your trip...</p>}

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
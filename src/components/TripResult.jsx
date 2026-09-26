import { formatMoney, DEFAULT_CURRENCY } from '../../shared/currency.js'

// Placeholder for the day currently being written, shown only while streaming.
const PendingDay = () => (
  <div className="loading" aria-hidden="true">
    <div className="day-panel">
      <div className="sk sk-day-label" />
      <div className="skeleton-card">
        <div className="sk sk-time" />
        <div className="sk-lines">
          <div className="sk sk-line" />
          <div className="sk sk-line short" />
        </div>
      </div>
    </div>
  </div>
)

const TripResult = ({ trip, streaming = false }) => {
  const currency = trip.budget?.currency || DEFAULT_CURRENCY
  const days = trip.days || []
  const hasBudget = typeof trip.budget?.estimated === 'number'

  return (
    <section className="dashboard">
      <header className="dash-header">
        <div>
          <h2 className="dash-title">
            {trip.destination || (streaming ? 'Working out your trip…' : '')}
          </h2>
          <p className="dash-meta">
            {trip.durationDays > 0 ? `${trip.durationDays} days` : streaming ? 'Planning' : ''}
          </p>
        </div>
        {hasBudget ? (
          <p className="budget-value">{formatMoney(trip.budget.estimated, currency)}</p>
        ) : (
          <p className="budget-value muted-value">{streaming ? 'Totalling…' : ''}</p>
        )}
      </header>

      {days.map((day) => (
        <div key={day.day} className="day-panel">
          <h3 className="day-title">Day {day.day}: {day.title}</h3>
          <ul className="activity-list">
            {day.activities.map((activity, index) => (
              <li key={index} className="activity-card">
                <span className="ac-time">{activity.time}</span>
                <div className="ac-body">
                  <strong className="ac-title">{activity.title}</strong>
                  {activity.location && <p className="ac-loc">{activity.location}</p>}
                  {activity.description && (
                    <p className="ac-desc">{activity.description}</p>
                  )}
                </div>
                <span className={`ac-cost${activity.cost ? '' : ' free'}`}>
                  {activity.cost ? formatMoney(activity.cost, currency) : 'Free'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {streaming && <PendingDay />}

      {trip.tips?.length > 0 && (
        <aside className="tips">
          <h4>Tips</h4>
          <ul>
            {trip.tips.map((tip, index) => (
              <li key={index}>{tip}</li>
            ))}
          </ul>
        </aside>
      )}
    </section>
  )
}

export default TripResult

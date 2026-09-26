import { formatMoney, DEFAULT_CURRENCY } from '../../shared/currency.js'

const TripResult = ({ trip }) => {
  const currency = trip.budget?.currency || DEFAULT_CURRENCY

  return (
    <section className="dashboard">
      <header className="dash-header">
        <div>
          <h2 className="dash-title">{trip.destination}</h2>
          <p className="dash-meta">{trip.durationDays} days</p>
        </div>
        <p className="budget-value">{formatMoney(trip.budget?.estimated, currency)}</p>
      </header>

      {trip.days.map((day) => (
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
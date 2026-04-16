import { Sidebar } from './components/Sidebar'
import { SessionView } from './components/SessionView'
import { useSessionsStore } from './state/sessionsStore'

export default function App(): JSX.Element {
  const open = useSessionsStore((s) => s.open)

  return (
    <div className="h-full w-full grid grid-cols-[260px_1fr] bg-bg text-fg">
      <Sidebar onConnect={(meta) => open(meta)} />
      <main className="min-w-0">
        <SessionView />
      </main>
    </div>
  )
}

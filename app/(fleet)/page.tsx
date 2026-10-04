import { CurrentTab } from '@/app/current-tab'

// Static: the dashboard's one page. The tab (`?view=`) and the live fleet come from the layout's
// client tree.
export default function FleetPage() {
  return <CurrentTab />
}

import { CurrentTab } from '@/app/current-tab'

// Static: the dashboard's one page. The tab (`?view=`) and the live vltra come from the layout's
// client tree.
export default function VltraPage() {
  return <CurrentTab />
}

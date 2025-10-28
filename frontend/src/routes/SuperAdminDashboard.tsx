import { BrandingPreview } from '../features/branding/BrandingPreview';
import { QueuePanel } from '../features/queue/QueuePanel';
import { SummaryCards } from '../features/queue/SummaryCards';

export function SuperAdminDashboard() {
  return (
    <div className="space-y-6">
      <SummaryCards scope="global" />
      <div className="grid gap-6 lg:grid-cols-2">
        <QueuePanel variant="wide" />
        <BrandingPreview showDirectory />
      </div>
    </div>
  );
}

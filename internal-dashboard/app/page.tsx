import DashboardClient from "./ui/dashboard-client";
import { getSignalRows, getSummary } from "@/lib/airtable";

async function getInitialData() {
  try {
    const [summary, signals] = await Promise.all([getSummary(), getSignalRows()]);
    return { summary, signals };
  } catch {
    return { summary: {}, signals: [] };
  }
}

export default async function Page() {
  const data = await getInitialData();
  return <DashboardClient initialData={data} />;
}

import ProcessDetail from '@/components/process/ProcessDetail';

export default async function VideoProcessPage({ params }) {
  const { id } = await params;
  return <ProcessDetail videoId={id} />;
}

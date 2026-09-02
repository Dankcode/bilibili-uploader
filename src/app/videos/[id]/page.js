import ProcessDetail from '@/components/process/ProcessDetail';

export default function VideoProcessPage({ params }) {
  return <ProcessDetail videoId={params.id} />;
}

import Link from 'next/link';

export default function NotFound() {
  return <main><p>This video does not exist.</p><Link href="/?view=library">Return to library</Link></main>;
}

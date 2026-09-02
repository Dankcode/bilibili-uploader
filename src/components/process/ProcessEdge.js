import styles from '../../app/page.module.css';

export default function ProcessEdge({ status }) {
  return <span className={`${styles.processEdge} ${styles[`processEdge${status[0]?.toUpperCase()}${status.slice(1)}`] || ''}`} aria-hidden="true"><i /></span>;
}

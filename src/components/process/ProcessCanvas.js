'use client';

import { useEffect, useRef } from 'react';
import ProcessEdge from './ProcessEdge';
import ProcessNode from './ProcessNode';
import styles from '../../app/page.module.css';

export default function ProcessCanvas({ graph, selectedId, onSelect }) {
  const nodeRefs = useRef(new Map());
  const nodes = graph?.nodes || [];
  useEffect(() => {
    const target = selectedId ? nodeRefs.current.get(selectedId) : null;
    target?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [selectedId]);
  function keyboard(event) {
    const index = nodes.findIndex((node) => node.id === selectedId);
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !nodes.length) return;
    event.preventDefault();
    const next = event.key === 'ArrowLeft' ? Math.max(0, index - 1) : Math.min(nodes.length - 1, index + 1);
    onSelect(nodes[next]?.id);
  }
  return (
    <div className={styles.processCanvasViewport} onKeyDown={keyboard} tabIndex={0} aria-label="Video process chain">
      <div className={styles.processCanvas} role="list">
        {nodes.map((node, index) => <div className={styles.processCanvasItem} key={node.id} ref={(element) => { if (element) nodeRefs.current.set(node.id, element); }}>
          <ProcessNode node={node} index={index} total={nodes.length} selected={node.id === selectedId} onSelect={onSelect} />
          {index < nodes.length - 1 ? <ProcessEdge status={graph.edges[index]?.status || 'pending'} /> : null}
        </div>)}
      </div>
    </div>
  );
}

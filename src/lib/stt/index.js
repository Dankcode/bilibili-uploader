import * as openaiWhisper from './openaiWhisper';
import * as localWhisper from './localWhisper';

const BACKENDS = {
  [openaiWhisper.id]: openaiWhisper,
  [localWhisper.id]: localWhisper,
};

export function getSttBackend(id = 'openaiWhisper') {
  return BACKENDS[id] || BACKENDS.openaiWhisper;
}

export function listSttBackends() {
  return Object.values(BACKENDS).map(({ id, label }) => ({ id, label }));
}

export const CATEGORIES = Object.freeze([
  { id: 'aim', label: 'Aim', description: 'Leitura, precisão, reação e troca de alvos.' },
  { id: 'crosshair', label: 'Crosshair', description: 'Controle puro da mira, sem clique.' }
]);

export const MODES = Object.freeze({
  tracking: {
    id: 'tracking',
    label: 'Tracking',
    category: 'aim',
    kind: 'tracking',
    continuous: true,
    durationMs: 30000,
    description: 'Mantenha a mira dentro do alvo em movimento.',
    focus: 'Acurácia sob movimento contínuo',
    copy: 'Alvo em deslocamento constante. Pontuação pela permanência do crosshair dentro da zona útil e pela estabilidade da mão.',
    metrics: ['tempo dentro do alvo', 'desvio médio', 'consistência']
  },
  clicking: {
    id: 'clicking',
    label: 'Clicking',
    category: 'aim',
    kind: 'click',
    durationMs: 30000,
    description: 'Acerte o maior número de alvos no tempo.',
    focus: 'Precisão em alvos estáticos',
    copy: 'Série de alvos com janela curta. Mede acerto, tempo de reação e penalidade por clique fora da área válida.',
    metrics: ['acertos', 'tempo por alvo', 'precisão']
  },
  flick: {
    id: 'flick',
    label: 'Flick',
    category: 'aim',
    kind: 'flick',
    durationMs: 30000,
    description: 'Corrija rápido: o primeiro clique decide.',
    focus: 'Correção rápida e travada',
    copy: 'Salto curto do alvo com janela mínima. Foca na primeira correção e no custo do movimento excessivo.',
    metrics: ['primeiro acerto', 'tempo de correção', 'overshoot']
  },
  switching: {
    id: 'switching',
    label: 'Target switching',
    category: 'aim',
    kind: 'switching',
    durationMs: 30000,
    description: 'Acerte apenas o alvo destacado.',
    focus: 'Leitura e troca sob pressão',
    copy: 'Múltiplos alvos disputando atenção. Avalia escolha, troca e manutenção do ritmo sem perder a referência.',
    metrics: ['troca correta', 'tempo de aquisição', 'sequência']
  },
  precision: {
    id: 'precision',
    label: 'Precision',
    category: 'aim',
    kind: 'precision',
    radiusFactor: 0.55,
    durationMs: 30000,
    description: 'Alvos pequenos: cada acerto vale mais.',
    focus: 'Precisão cirúrgica em alvo reduzido',
    copy: 'Zona válida bem menor que a média. Penaliza movimento frouxo e recompensa acerto limpo no centro.',
    metrics: ['acertos limpos', 'erros', 'precisão']
  },
  speed: {
    id: 'speed',
    label: 'Speed',
    category: 'aim',
    kind: 'speed',
    targetLifeMs: 900,
    durationMs: 30000,
    description: 'Alvo some rápido: não espere.',
    focus: 'Velocidade de aquisição sob expiração',
    copy: 'Cada alvo tem janela de novecentos milissegundos. Se expirou, conta como erro e um novo aparece imediatamente.',
    metrics: ['acertos por segundo', 'expirações', 'ritmo']
  },
  crosshair_follow: {
    id: 'crosshair_follow',
    label: 'Crosshair follow',
    category: 'crosshair',
    kind: 'follow',
    continuous: true,
    durationMs: 30000,
    description: 'Acompanhe o guia com a mira, sem clicar.',
    focus: 'Rastreamento do ponteiro sem disparo',
    copy: 'Guia em curva contínua. A pontuação vem do tempo em que a mira permanece sobre o caminho; o mouse é seguido um para um.',
    metrics: ['tempo no guia', 'suavidade', 'desvio']
  },
  crosshair_stability: {
    id: 'crosshair_stability',
    label: 'Crosshair hold',
    category: 'crosshair',
    kind: 'stability',
    continuous: true,
    radiusFactor: 0.7,
    durationMs: 30000,
    description: 'Segure a mira no centro sem tremer.',
    focus: 'Estática absoluta da mão',
    copy: 'Alvo central pequeno e movimento mínimo. Mede permanência e recompensa a mão parada de verdade.',
    metrics: ['tempo estável', 'tremor', 'consistência']
  },
  crosshair_grid: {
    id: 'crosshair_grid',
    label: 'Crosshair grid',
    category: 'crosshair',
    kind: 'grid',
    holdMs: 160,
    durationMs: 30000,
    description: 'Passe pelos pontos da grade e segure.',
    focus: 'Precisão posicional em sequência',
    copy: 'Nove pontos fixos. O próximo só libera depois de uma pausa curta sobre o ponto atual, sem clique.',
    metrics: ['pontos alcançados', 'estabilidade', 'tempo por ponto']
  }
});

export const modeList = Object.freeze(Object.values(MODES));

export function modesByCategory(category) {
  return modeList.filter(mode => mode.category === category);
}

/**
 * 博士キャラクター表示コンポーネント（issue #11 / 追加指示 §4・§6・§7・§8）。
 *
 * - スプライト: public/assets/characters/{banno,higedaruma}/{state}.png
 *   全8枚は 135x268 の共通キャンバス・足元揃え・透過PNG（切り出しは
 *   scripts/slice-characters.mjs。座標は解析+目視で確定）。
 * - ここは「表示だけ」を担う。どの状態をいつ出すか（申請確認・実験待ち・
 *   生成中・誕生）は breeding-state.ts の純関数が決め、main.ts が渡す
 *   （追加指示 §7: 状態管理と表示の分離）。
 * - アニメは CSS（.char[data-state]）。prefers-reduced-motion は style.css の
 *   全体ルールですべて無効化される。
 * - 読み上げ重複防止（§8）: セリフがあるときは <img alt="">（セリフだけ読む）、
 *   セリフが無いときは role="img" + aria-label で1回だけ、装飾指定なら aria-hidden。
 * - image-rendering: pixelated で補間禁止・比率維持（CSS側）。
 */
import bannoIdle from './assets/characters/banno/idle.png';
import bannoSuccess from './assets/characters/banno/success.png';
import bannoThinking from './assets/characters/banno/thinking.png';
import bannoCelebration from './assets/characters/banno/celebration.png';
import higedarumaIdle from './assets/characters/higedaruma/idle.png';
import higedarumaSuccess from './assets/characters/higedaruma/success.png';
import higedarumaThinking from './assets/characters/higedaruma/thinking.png';
import higedarumaCelebration from './assets/characters/higedaruma/celebration.png';

export type CharacterName = 'banno' | 'higedaruma';
export type CharacterState = 'idle' | 'success' | 'thinking' | 'celebration';

export const CHARACTER_LABEL: Record<CharacterName, string> = {
  banno: '伴野博士',
  higedaruma: 'ひげだるま博士',
};

const STATE_LABEL: Record<CharacterState, string> = {
  idle: '通常',
  success: '申請完了によろこぶ顔',
  thinking: '実験中・考え中の顔',
  celebration: '大よろこびの顔',
};

const SPRITES: Record<CharacterName, Record<CharacterState, string>> = {
  banno: {
    idle: bannoIdle,
    success: bannoSuccess,
    thinking: bannoThinking,
    celebration: bannoCelebration,
  },
  higedaruma: {
    idle: higedarumaIdle,
    success: higedarumaSuccess,
    thinking: higedarumaThinking,
    celebration: higedarumaCelebration,
  },
};

export interface CharacterOptions {
  state?: CharacterState;
  /** セリフ。null/未指定なら role=img + aria-label で状態を1回だけ読む */
  message?: string | null;
  /** true なら完全な装飾（aria-hidden。家系図の補助表示など） */
  decorative?: boolean;
}

export interface CharacterHandle {
  readonly el: HTMLElement;
  setState(state: CharacterState): void;
  setMessage(message: string | null): void;
  getState(): CharacterState;
}

export function createCharacter(
  name: CharacterName,
  opts: CharacterOptions = {},
): CharacterHandle {
  let state: CharacterState = opts.state ?? 'idle';
  let message: string | null = opts.message ?? null;
  const decorative = opts.decorative ?? false;

  const root = document.createElement('div');
  root.className = 'char';
  root.dataset.char = name;

  const img = document.createElement('img');
  img.className = 'char-img';
  img.width = 135; // 実像素（CLS防止も兼ねる）
  img.height = 268;
  img.decoding = 'async';
  img.alt = '';

  const msg = document.createElement('p');
  msg.className = 'char-msg';

  /** 状態・セリフ・aria を常に一致させる（二重読み上げを作らない） */
  const sync = (): void => {
    root.dataset.state = state;
    img.src = SPRITES[name][state];
    msg.textContent = message ?? '';
    msg.hidden = message === null;
    if (decorative) {
      root.setAttribute('aria-hidden', 'true');
      root.removeAttribute('role');
      root.removeAttribute('aria-label');
    } else if (message !== null) {
      root.removeAttribute('role');
      root.removeAttribute('aria-label');
    } else {
      root.setAttribute('role', 'img');
      root.setAttribute('aria-label', `${CHARACTER_LABEL[name]}（${STATE_LABEL[state]}）`);
    }
  };
  sync();
  root.append(img, msg);

  return {
    el: root,
    setState(next) {
      state = next;
      sync();
    },
    setMessage(next) {
      message = next;
      sync();
    },
    getState: () => state,
  };
}

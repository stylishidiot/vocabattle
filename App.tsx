import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { PARTS, type Part } from './src/data/parts';
import { WORDS } from './src/data/words';
import { AI_PROFILES, PLAYER_MAX_HP } from './src/lib/config';
import { calcDamage } from './src/lib/damage';
import {
  buildWordFromParts,
  eligibleWordsForPrompt,
  findWord,
  pickPrompt,
  validateAgainstPrompt,
} from './src/lib/engine';
import type { Difficulty, TurnPhase, TurnResult } from './src/lib/types';
import {
  DEFAULT_PROGRESS,
  DEFAULT_SETTINGS,
  loadProgress,
  loadSettings,
  resetAll,
  saveProgress,
  saveSettings,
  type Progress,
  type Settings,
} from './src/lib/storage';

type Screen = 'home' | 'battle' | 'result' | 'dex' | 'settings';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [progress, setProgress] = useState<Progress>(DEFAULT_PROGRESS);
  const [loading, setLoading] = useState(true);

  // Battle state
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const ai = useMemo(() => AI_PROFILES[difficulty], [difficulty]);
  const [playerHp, setPlayerHp] = useState(PLAYER_MAX_HP);
  const [aiHp, setAiHp] = useState(ai.maxHp);
  const [phase, setPhase] = useState<TurnPhase>('intro');
  const [turnIndex, setTurnIndex] = useState(1);
  const [playerCombo, setPlayerCombo] = useState(0);
  const [aiCombo, setAiCombo] = useState(0);
  const [selectedParts, setSelectedParts] = useState<string[]>([]);
  const [timeLeftMs, setTimeLeftMs] = useState(0);
  const [result, setResult] = useState<TurnResult | null>(null);
  const [message, setMessage] = useState<string>('');

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const phaseRef = useRef<TurnPhase>('intro');
  phaseRef.current = phase;

  // Shake animation
  const shakeX = useRef(new Animated.Value(0)).current;
  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 8, duration: 40, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -8, duration: 40, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 5, duration: 40, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -5, duration: 40, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 40, useNativeDriver: true }),
    ]).start();
  };

  // load local data
  useEffect(() => {
    (async () => {
      const s = await loadSettings();
      const p = await loadProgress();
      setSettings(s);
      setDifficulty(s.difficulty);
      setProgress(p);
      setLoading(false);
    })();
  }, []);

  // keep ai hp synced when difficulty changes
  useEffect(() => {
    setAiHp(ai.maxHp);
  }, [ai.maxHp]);

  const prompt = useMemo(() => {
    return pickPrompt(difficulty, ai.timeLimitSec);
  }, [difficulty, ai.timeLimitSec, turnIndex]);

  // phase machine
  useEffect(() => {
    if (screen !== 'battle') return;
    if (loading) return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (phase === 'intro') {
      setMessage('');
      setSelectedParts([]);
      setTimeLeftMs(prompt.timeLimitSec * 1000);
      const t = setTimeout(() => setPhase('answer'), 1000);
      return () => clearTimeout(t);
    }

    if (phase === 'answer') {
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - start;
        const left = Math.max(0, prompt.timeLimitSec * 1000 - elapsed);
        setTimeLeftMs(left);
        if (left <= 0 && phaseRef.current === 'answer') {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          // time up -> judge with empty word
          doJudge({ playerSubmitted: false });
        }
      }, 50);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, screen, loading, prompt.id, prompt.timeLimitSec]);

  function hpColor(hp: number, maxHp: number): string {
    const ratio = hp / maxHp;
    if (ratio >= 0.6) return '#22c55e';
    if (ratio >= 0.3) return '#eab308';
    return '#ef4444';
  }

  function addPart(p: Part) {
    if (phase !== 'answer') return;
    // MVP: 追加順は「prefix→root→suffix」の見た目を崩さない
    // ただしユーザーが自由に押せるように、内部では押した順を保存。
    setSelectedParts((prev) => [...prev, p.id]);
  }

  function removeAt(i: number) {
    if (phase !== 'answer') return;
    setSelectedParts((prev) => prev.filter((_, idx) => idx !== i));
  }

  function clearSelection() {
    if (phase !== 'answer') return;
    setSelectedParts([]);
  }

  function submit() {
    if (phase !== 'answer') return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    doJudge({ playerSubmitted: true });
  }

  function doJudge(opts: { playerSubmitted: boolean }) {
    setPhase('judge');

    // Player word
    const playerWordText = opts.playerSubmitted ? buildWordFromParts(selectedParts) : '';
    const playerWord = playerWordText ? findWord(playerWordText) : undefined;
    const playerCorrect = validateAgainstPrompt(playerWord, prompt);

    // AI answer
    const eligible = eligibleWordsForPrompt({ prompt, vocabLevelMax: ai.vocabLevelMax });
    const aiWillCorrect = Math.random() < ai.accuracy && eligible.length > 0;
    const aiChosen = aiWillCorrect
      ? eligible[Math.floor(Math.random() * eligible.length)]
      : undefined;

    // AI answer time
    const aiAnswerSec = Math.max(0.2, ai.baseAnswerSec + (Math.random() * 2 - 1) * ai.jitterSec);
    const aiInTime = aiAnswerSec <= prompt.timeLimitSec;
    const aiCorrect = !!aiChosen && aiInTime;

    // Combo tracking (streak = 連続正解数)
    const nextPlayerCombo = playerCorrect ? Math.min(99, playerCombo + 1) : 0;
    const nextAiCombo = aiCorrect ? Math.min(99, aiCombo + 1) : 0;
    setPlayerCombo(nextPlayerCombo);
    setAiCombo(nextAiCombo);

    // Remaining seconds for speed bonus
    const remainingSecPlayer = timeLeftMs / 1000;
    const remainingSecAi = Math.max(0, prompt.timeLimitSec - aiAnswerSec);

    const playerDamage = playerCorrect
      ? calcDamage({ remainingSec: remainingSecPlayer, comboStreak: nextPlayerCombo })
      : { base: 0, speedBonus: 0, comboBonus: 0, total: 0 };
    const aiDamage = aiCorrect
      ? calcDamage({ remainingSec: remainingSecAi, comboStreak: nextAiCombo })
      : { base: 0, speedBonus: 0, comboBonus: 0, total: 0 };

    const r: TurnResult = {
      prompt,
      playerWord: playerWordText || '(未入力)',
      aiWord: aiChosen?.text ?? '(不正解)',
      playerCorrect,
      aiCorrect,
      playerDamageToAi: playerDamage,
      aiDamageToPlayer: aiDamage,
    };
    setResult(r);

    // update progress (ローカル保存)
    const updated: Progress = {
      part: { ...progress.part },
      word: { ...progress.word },
    };
    const seenParts = new Set<string>();
    if (playerWord) {
      playerWord.parts.forEach((pid) => seenParts.add(pid));
      updated.word[playerWord.id] = updated.word[playerWord.id] ?? { seen: 0, correct: 0, wrong: 0 };
      updated.word[playerWord.id].seen += 1;
      if (playerCorrect) updated.word[playerWord.id].correct += 1;
      else updated.word[playerWord.id].wrong += 1;
    }
    // parts stats (見たパーツ = お題のrequiresParts + 自分が使ったパーツ)
    [...prompt.requiresParts, ...seenParts].forEach((pid) => {
      updated.part[pid] = updated.part[pid] ?? { seen: 0, correct: 0, wrong: 0 };
      updated.part[pid].seen += 1;
      if (playerCorrect) updated.part[pid].correct += 1;
      else updated.part[pid].wrong += 1;
    });
    setProgress(updated);
    void saveProgress(updated);

    // judge text + shake
    if ((playerCorrect && !aiCorrect) || (!playerCorrect && aiCorrect) || (playerCorrect && aiCorrect)) {
      shake();
    }

    const judgeTimer = setTimeout(() => setPhase('hp'), 2000);
    return () => clearTimeout(judgeTimer);
  }

  useEffect(() => {
    if (phase !== 'hp') return;
    if (!result) return;

    // Apply HP changes
    const newAiHp = Math.max(0, aiHp - result.playerDamageToAi.total);
    const newPlayerHp = Math.max(0, playerHp - result.aiDamageToPlayer.total);
    setAiHp(newAiHp);
    setPlayerHp(newPlayerHp);

    const t = setTimeout(() => {
      const ended = newAiHp <= 0 || newPlayerHp <= 0;
      if (ended) {
        setScreen('result');
        setPhase('end');
      } else {
        setTurnIndex((v) => v + 1);
        setPhase('intro');
      }
    }, 1000);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function startBattle() {
    setDifficulty(settings.difficulty);
    const profile = AI_PROFILES[settings.difficulty];
    setPlayerHp(PLAYER_MAX_HP);
    setAiHp(profile.maxHp);
    setPlayerCombo(0);
    setAiCombo(0);
    setTurnIndex(1);
    setResult(null);
    setSelectedParts([]);
    setPhase('intro');
    setScreen('battle');
  }

  async function updateSettings(next: Settings) {
    setSettings(next);
    setDifficulty(next.difficulty);
    await saveSettings(next);
  }

  async function wipeLocalData() {
    await resetAll();
    setSettings(DEFAULT_SETTINGS);
    setDifficulty(DEFAULT_SETTINGS.difficulty);
    setProgress(DEFAULT_PROGRESS);
  }

  const builtWord = useMemo(() => buildWordFromParts(selectedParts), [selectedParts]);
  const timeLeftSec = useMemo(() => Math.max(0, timeLeftMs / 1000), [timeLeftMs]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <Text style={styles.title}>Vocab Battle</Text>
        <Text style={styles.sub}>読み込み中...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />

      {screen === 'home' && (
        <View style={styles.container}>
          <Text style={styles.title}>Vocab Battle</Text>
          <Text style={styles.sub}>語彙パーツで単語を組み立てて、AIと同時バトル。</Text>

          <View style={{ height: 14 }} />

          <PrimaryButton label="バトル開始" onPress={startBattle} />
          <View style={{ height: 10 }} />
          <SecondaryButton label="図鑑（進捗）" onPress={() => setScreen('dex')} />
          <View style={{ height: 10 }} />
          <SecondaryButton label="設定" onPress={() => setScreen('settings')} />

          <View style={{ height: 18 }} />
          <Text style={styles.note}>※ 課金なし（広告は後で追加しやすい構成）</Text>
        </View>
      )}

      {screen === 'battle' && (
        <Animated.View style={[styles.container, { transform: [{ translateX: shakeX }] }]}>
          <HpRow
            leftLabel={`You  ${playerHp}/${PLAYER_MAX_HP}`}
            leftValue={playerHp}
            leftMax={PLAYER_MAX_HP}
            rightLabel={`${ai.name}  ${aiHp}/${ai.maxHp}`}
            rightValue={aiHp}
            rightMax={ai.maxHp}
          />

          <View style={styles.card}>
            <Text style={styles.promptTitle}>お題</Text>
            <Text style={styles.promptText}>{prompt.textJa}</Text>
            <View style={{ height: 10 }} />
            <Text style={styles.timer}>⏱️ {timeLeftSec.toFixed(1)}s</Text>
            {phase === 'intro' && <Text style={styles.phase}>（準備…）</Text>}
            {phase === 'judge' && <Text style={styles.phase}>（判定中…）</Text>}
            {phase === 'hp' && <Text style={styles.phase}>（ダメージ反映…）</Text>}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>選択中</Text>
            <Text style={styles.builtWord}>{builtWord || '（まだ選んでない）'}</Text>
            <View style={{ height: 8 }} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {selectedParts.map((pid, idx) => (
                  <Chip
                    key={`${pid}-${idx}`}
                    label={pid}
                    sub="タップで削除"
                    onPress={() => removeAt(idx)}
                  />
                ))}
              </View>
            </ScrollView>

            <View style={{ height: 10 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <SecondaryButton label="クリア" onPress={clearSelection} disabled={phase !== 'answer'} />
              <PrimaryButton label="決定" onPress={submit} disabled={phase !== 'answer'} />
            </View>
          </View>

          <ScrollView style={{ flex: 1 }}>
            <PartGrid
              title="接頭辞"
              parts={PARTS.filter((p) => p.type === 'prefix')}
              onPick={addPart}
              disabled={phase !== 'answer'}
            />
            <PartGrid
              title="語根"
              parts={PARTS.filter((p) => p.type === 'root')}
              onPick={addPart}
              disabled={phase !== 'answer'}
            />
            <PartGrid
              title="接尾辞"
              parts={PARTS.filter((p) => p.type === 'suffix')}
              onPick={addPart}
              disabled={phase !== 'answer'}
            />
            <View style={{ height: 24 }} />
          </ScrollView>

          {result && (phase === 'judge' || phase === 'hp') && (
            <View style={styles.judgePanel}>
              <Text style={styles.judgeTitle}>判定</Text>
              <Text style={styles.judgeLine}>
                You: {result.playerWord} {result.playerCorrect ? '✓' : '✗'}  → {result.playerDamageToAi.total}ダメージ
              </Text>
              <Text style={styles.judgeLine}>
                AI: {result.aiWord} {result.aiCorrect ? '✓' : '✗'}  → {result.aiDamageToPlayer.total}ダメージ
              </Text>
              <Text style={styles.judgeNote}>コンボ: You {playerCombo} / AI {aiCombo}</Text>
            </View>
          )}
        </Animated.View>
      )}

      {screen === 'result' && (
        <View style={styles.container}>
          <Text style={styles.title}>{aiHp <= 0 ? '🎉 VICTORY!' : '💪 TRY AGAIN'}</Text>
          <Text style={styles.sub}>ターン数: {turnIndex}</Text>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>今回のメモ</Text>
            <Text style={styles.note}>間違えたら、図鑑で復習しよう。</Text>
          </View>

          <PrimaryButton label="もう一回" onPress={startBattle} />
          <View style={{ height: 10 }} />
          <SecondaryButton label="図鑑" onPress={() => setScreen('dex')} />
          <View style={{ height: 10 }} />
          <SecondaryButton label="ホーム" onPress={() => setScreen('home')} />
        </View>
      )}

      {screen === 'dex' && (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>図鑑（進捗）</Text>
          <Text style={styles.sub}>ローカル保存。端末の中だけに残る。</Text>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>パーツ</Text>
            <View style={{ height: 10 }} />
            {PARTS.map((p) => {
              const st = progress.part[p.id] ?? { seen: 0, correct: 0, wrong: 0 };
              const rate = st.seen > 0 ? Math.round((st.correct / st.seen) * 100) : 0;
              return (
                <View key={p.id} style={styles.rowBetween}>
                  <Text style={styles.mono}>{p.text}</Text>
                  <Text style={styles.note}>seen {st.seen} / ✓ {rate}%</Text>
                </View>
              );
            })}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>単語</Text>
            <View style={{ height: 10 }} />
            {WORDS.map((w) => {
              const st = progress.word[w.id] ?? { seen: 0, correct: 0, wrong: 0 };
              const rate = st.seen > 0 ? Math.round((st.correct / st.seen) * 100) : 0;
              return (
                <View key={w.id} style={styles.rowBetween}>
                  <Text style={styles.mono}>{w.text}</Text>
                  <Text style={styles.note}>seen {st.seen} / ✓ {rate}%</Text>
                </View>
              );
            })}
          </View>

          <SecondaryButton label="ホーム" onPress={() => setScreen('home')} />
          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      {screen === 'settings' && (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>設定</Text>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>難易度</Text>
            <Text style={styles.note}>今は課金なし。広告は後で追加しやすい。</Text>
            <View style={{ height: 10 }} />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {([1, 2, 3, 4, 5] as Difficulty[]).map((d) => (
                <Pressable
                  key={d}
                  onPress={() => updateSettings({ ...settings, difficulty: d })}
                  style={[styles.badge, settings.difficulty === d && styles.badgeActive]}
                >
                  <Text style={styles.badgeText}>{'⭐'.repeat(d)}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>データ</Text>
            <Text style={styles.note}>進捗が壊れた時はここで初期化。</Text>
            <View style={{ height: 10 }} />
            <SecondaryButton label="ローカルデータを消す" onPress={wipeLocalData} />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>プライバシー</Text>
            <Text style={styles.note}>
              このMVPは端末内に学習記録を保存するだけ。サーバー送信はしない。
            </Text>
          </View>

          <SecondaryButton label="ホーム" onPress={() => setScreen('home')} />
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function HpRow(props: {
  leftLabel: string;
  leftValue: number;
  leftMax: number;
  rightLabel: string;
  rightValue: number;
  rightMax: number;
}) {
  const leftRatio = Math.max(0, Math.min(1, props.leftValue / props.leftMax));
  const rightRatio = Math.max(0, Math.min(1, props.rightValue / props.rightMax));
  return (
    <View style={styles.hpRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.hpLabel}>{props.leftLabel}</Text>
        <View style={styles.hpBarBg}>
          <View style={[styles.hpBarFill, { width: `${leftRatio * 100}%`, backgroundColor: leftRatio >= 0.6 ? '#22c55e' : leftRatio >= 0.3 ? '#eab308' : '#ef4444' }]} />
        </View>
      </View>
      <View style={{ width: 12 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.hpLabel}>{props.rightLabel}</Text>
        <View style={styles.hpBarBg}>
          <View style={[styles.hpBarFill, { width: `${rightRatio * 100}%`, backgroundColor: rightRatio >= 0.6 ? '#22c55e' : rightRatio >= 0.3 ? '#eab308' : '#ef4444' }]} />
        </View>
      </View>
    </View>
  );
}

function PartGrid(props: {
  title: string;
  parts: Part[];
  onPick: (p: Part) => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      <View style={{ height: 10 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {props.parts.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => props.onPick(p)}
            disabled={props.disabled}
            style={[styles.partBtn, props.disabled && styles.disabled]}
          >
            <Text style={styles.partText}>{p.text}</Text>
            <Text style={styles.partSub}>{p.meaningJa}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Chip(props: { label: string; sub?: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={styles.chip}>
      <Text style={styles.chipText}>{props.label}</Text>
      {!!props.sub && <Text style={styles.chipSub}>{props.sub}</Text>}
    </Pressable>
  );
}

function PrimaryButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!!props.disabled}
      style={[styles.btn, styles.btnPrimary, props.disabled && styles.disabled]}
    >
      <Text style={styles.btnText}>{props.label}</Text>
    </Pressable>
  );
}

function SecondaryButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!!props.disabled}
      style={[styles.btn, styles.btnSecondary, props.disabled && styles.disabled]}
    >
      <Text style={styles.btnText}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0B0F1A',
  },
  container: {
    flexGrow: 1,
    padding: 16,
    gap: 12,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#E6EDF3',
  },
  sub: {
    marginTop: 6,
    fontSize: 14,
    color: '#A9B1BC',
    lineHeight: 20,
  },
  note: {
    fontSize: 13,
    color: '#A9B1BC',
    lineHeight: 19,
  },
  mono: {
    fontSize: 14,
    color: '#E6EDF3',
    fontFamily: 'monospace',
  },
  card: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  hpRow: {
    flexDirection: 'row',
    gap: 12,
  },
  hpLabel: {
    color: '#A9B1BC',
    fontSize: 12,
    marginBottom: 6,
  },
  hpBarBg: {
    height: 10,
    borderRadius: 8,
    backgroundColor: '#0B1220',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  hpBarFill: {
    height: '100%',
  },
  promptTitle: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '700',
  },
  promptText: {
    color: '#E6EDF3',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
    lineHeight: 22,
  },
  timer: {
    color: '#E6EDF3',
    fontSize: 16,
    fontWeight: '800',
  },
  phase: {
    marginTop: 4,
    color: '#A9B1BC',
    fontSize: 12,
  },
  sectionTitle: {
    color: '#E6EDF3',
    fontSize: 14,
    fontWeight: '800',
  },
  builtWord: {
    color: '#E6EDF3',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 6,
    letterSpacing: 0.2,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  partBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#243244',
    backgroundColor: '#0B1220',
    minWidth: 92,
  },
  partText: {
    color: '#E6EDF3',
    fontSize: 14,
    fontWeight: '800',
  },
  partSub: {
    color: '#A9B1BC',
    fontSize: 11,
    marginTop: 2,
  },
  btn: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: '#2563EB',
  },
  btnSecondary: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#243244',
  },
  btnText: {
    color: '#E6EDF3',
    fontSize: 15,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.5,
  },
  chip: {
    backgroundColor: '#0B1220',
    borderColor: '#243244',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  chipText: {
    color: '#E6EDF3',
    fontWeight: '800',
  },
  chipSub: {
    color: '#A9B1BC',
    fontSize: 10,
    marginTop: 2,
  },
  judgePanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    backgroundColor: '#0B1220',
    borderColor: '#243244',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  judgeTitle: {
    color: '#93C5FD',
    fontWeight: '900',
    marginBottom: 6,
  },
  judgeLine: {
    color: '#E6EDF3',
    fontSize: 13,
    lineHeight: 18,
  },
  judgeNote: {
    marginTop: 6,
    color: '#A9B1BC',
    fontSize: 12,
  },
  badge: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#243244',
    backgroundColor: '#0B1220',
  },
  badgeActive: {
    borderColor: '#60A5FA',
  },
  badgeText: {
    color: '#E6EDF3',
    fontWeight: '900',
  },
});

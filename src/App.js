import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const COMMON_WORDS = new Set([
  'a', 'an', 'the', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'of', 'to', 'and', 'in', 'for', 'on', 'with', 'is',
  'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'not', 'this', 'that', 'these',
  'those', 'from', 'by', 'as', 'at', 'or', 'but', 'if', 'then', 'so', 'because', 'about', 'into', 'over', 'after',
  'before', 'up', 'down', 'out', 'more', 'most', 'some', 'any', 'no', 'yes', 'can', 'could', 'should', 'would',
  'will', 'shall', 'may', 'might', 'just', 'only', 'also', 'very', 'how', 'what', 'when', 'where', 'who', 'why',
  'which', 'while', 'during', 'each', 'other', 'than', 'such', 'their', 'my', 'your', 'his', 'her', 'its', 'our',
  'their', 'me', 'him', 'them', 'us', 'one', 'two', 'three', 'first', 'second', 'time', 'new', 'good', 'day', 'year',
  'life', 'work', 'use', 'make', 'go', 'know', 'see', 'need', 'feel', 'think', 'take', 'give', 'find', 'want', 'tell',
  'seem', 'put', 'like', 'help', 'run', 'call', 'look', 'back', 'right', 'left', 'large', 'small', 'long', 'short'
]);

const REQUEST_TIMEOUT = 9000;
const QUIZ_SIZE = 7;
const TODAY = () => new Date().toISOString().slice(0, 10);
const REVIEW_STEPS = [1, 3, 7, 14];

const STORAGE_KEYS = {
  counts: 'word_search_counts',
  wordbook: 'wordbook_entries_v3',
  dailyGoal: 'daily_goal',
  missed: 'missed_words'
};

const normalize = (text) => text.trim().toLowerCase();

const fetchWithTimeout = async (url, options = {}) => {
  const { timeout = REQUEST_TIMEOUT, signal, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'AbortError')), timeout);
  const abortListener =
    signal && (() => controller.abort(signal.reason || new DOMException('Request aborted', 'AbortError')));

  if (signal && abortListener) {
    signal.addEventListener('abort', abortListener);
  }

  try {
    const response = await fetch(url, { ...rest, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }
};

const cloneDefinitionPayload = (payload) => ({
  ...payload,
  definitions: (payload.definitions || []).map((entry) => ({
    ...entry,
    meanings: (entry.meanings || []).map((meaning) => ({
      ...meaning,
      definitions: [...(meaning.definitions || [])]
    }))
  }))
});

const loadFromStorage = (key, fallback) => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn('读取本地存储失败', error);
    return fallback;
  }
};

const ensureStats = (stats = {}) => ({
  tests: stats.tests || 0,
  correct: stats.correct || 0,
  streak: stats.streak || 0,
  lastTested: stats.lastTested || 0,
  nextReview: stats.nextReview || 0
});

const migrateWordbook = (entries = []) =>
  entries
    .map((item) => {
      const word = item.word || item.term || '';
      if (!word) return null;
      return {
        word,
        definition: item.definition || item.translated || '已收藏',
        phonetic: item.phonetic || '',
        addedAt: item.addedAt || Date.now(),
        source: item.source || '自动收藏',
        note: item.note || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        stats: ensureStats(item.stats)
      };
    })
    .filter(Boolean);

const shuffle = (arr) => {
  const clone = [...arr];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
};

const cleanDefinition = (text = '') => text.replace(/\s+/g, ' ').trim();

const hydrateDailyGoal = (saved) => {
  const fallback = { target: 15, completed: 0, date: TODAY() };
  if (!saved) return fallback;
  if (saved.date !== TODAY()) {
    return { ...fallback, target: saved.target || fallback.target };
  }
  return {
    target: saved.target || fallback.target,
    completed: saved.completed || 0,
    date: TODAY()
  };
};

function App() {
  const [text, setText] = useState('');
  const [definitions, setDefinitions] = useState([]);
  const [translation, setTranslation] = useState('');
  const [rareWords, setRareWords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchCounts, setSearchCounts] = useState(() => loadFromStorage(STORAGE_KEYS.counts, {}));
  const [wordbook, setWordbook] = useState(() => migrateWordbook(loadFromStorage(STORAGE_KEYS.wordbook, [])));
  const [batchText, setBatchText] = useState('');
  const [batchStatus, setBatchStatus] = useState({ total: 0, processed: 0, message: '' });
  const [batchLoading, setBatchLoading] = useState(false);
  const [quizState, setQuizState] = useState({
    active: false,
    finished: false,
    current: 0,
    score: 0,
    questions: []
  });
  const [quizError, setQuizError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [dailyGoal, setDailyGoal] = useState(() => hydrateDailyGoal(loadFromStorage(STORAGE_KEYS.dailyGoal)));
  const [missedWords, setMissedWords] = useState(() => loadFromStorage(STORAGE_KEYS.missed, []));
  const [flashState, setFlashState] = useState({ queue: [], index: 0, reveal: false });
  const [manualWord, setManualWord] = useState('');
  const [manualDefinition, setManualDefinition] = useState('');
  const [manualTags, setManualTags] = useState('');
  const [filterText, setFilterText] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [exportData, setExportData] = useState('');
  const [importText, setImportText] = useState('');
  const [toast, setToast] = useState('');

  const cacheRef = useRef({ definitions: {}, translations: {} });
  const requestControllerRef = useRef(null);

  const isSentence = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    return /\s/.test(trimmed);
  }, [text]);

  const dailyProgress = useMemo(() => {
    const safeTarget = Math.max(dailyGoal.target || 1, 1);
    return Math.min(100, Math.round((dailyGoal.completed / safeTarget) * 100));
  }, [dailyGoal]);

  const reviewList = useMemo(() => {
    const sorted = [...wordbook].sort((a, b) => (a.stats.nextReview || 0) - (b.stats.nextReview || 0));
    return sorted.slice(0, 8);
  }, [wordbook]);

  const filteredWordbook = useMemo(() => {
    const ft = filterText.trim().toLowerCase();
    return wordbook.filter((item) => {
      const matchText =
        !ft ||
        item.word.toLowerCase().includes(ft) ||
        (item.definition || '').toLowerCase().includes(ft) ||
        (item.note || '').toLowerCase().includes(ft);
      const matchTag = !filterTag || (item.tags || []).includes(filterTag);
      return matchText && matchTag;
    });
  }, [wordbook, filterText, filterTag]);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        if (window.persist?.loadData) {
          const data = await window.persist.loadData();
          if (cancelled) return;
          if (data?.wordbook) setWordbook(migrateWordbook(data.wordbook));
          if (data?.searchCounts) setSearchCounts(data.searchCounts);
          if (data?.dailyGoal) setDailyGoal(hydrateDailyGoal(data.dailyGoal));
          if (data?.missedWords) setMissedWords(Array.isArray(data.missedWords) ? data.missedWords : []);
        }
      } catch (err) {
        console.warn('读取本地进度失败，将使用浏览器存储', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };
    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload = { wordbook, searchCounts, dailyGoal, missedWords };
    if (window.persist?.saveData) {
      window.persist.saveData(payload).catch((err) => console.warn('写入本地进度失败', err));
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.wordbook, JSON.stringify(wordbook));
      window.localStorage.setItem(STORAGE_KEYS.counts, JSON.stringify(searchCounts));
      window.localStorage.setItem(STORAGE_KEYS.dailyGoal, JSON.stringify(dailyGoal));
      window.localStorage.setItem(STORAGE_KEYS.missed, JSON.stringify(missedWords));
    } catch (err) {
      console.warn('写入 localStorage 失败', err);
    }
  }, [wordbook, searchCounts, dailyGoal, missedWords, hydrated]);

  useEffect(() => {
    const queue = buildFlashQueue(wordbook);
    setFlashState((prev) => ({
      queue,
      index: 0,
      reveal: false
    }));
  }, [wordbook]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const query = text.trim();
    if (!query) return;

    const normalized = normalize(query);
    const nextCounts = {
      ...searchCounts,
      [normalized]: (searchCounts[normalized] || 0) + 1
    };
    const reachedThreshold = nextCounts[normalized] >= 3;
    setSearchCounts(nextCounts);

    setLoading(true);
    setError('');
    setDefinitions([]);
    setTranslation('');
    setRareWords([]);

    if (requestControllerRef.current) {
      requestControllerRef.current.abort();
    }
    const controller = new AbortController();
    requestControllerRef.current = controller;

    try {
      if (isSentence) {
        await handleSentenceFlow(query, reachedThreshold, normalized, controller.signal);
      } else {
        await handleWordFlow(normalized, reachedThreshold, controller.signal);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return;
      }
      console.error(err);
      setError('请求失败，请稍后再试或检查网络。');
    } finally {
      setLoading(false);
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  };

  const handleWordFlow = async (word, autoSave, signal) => {
    const result = await fetchDefinition(word, signal);
    setDefinitions(result.definitions);
    if (!result.definitions.length) {
      setError('没有找到相关释义（尝试其他词或检查拼写）。');
    }
    if (autoSave && result.primaryDefinition) {
      addToWordbook(word, {
        definition: result.primaryDefinition,
        phonetic: result.definitions[0]?.phonetic,
        source: '自动收藏'
      });
      incrementDailyGoal(1);
    }
  };

  const handleSentenceFlow = async (sentence, autoSave, cacheKey, signal) => {
    const translated = await fetchTranslation(sentence, signal);
    setTranslation(translated);
    const rareDetails = await findRareWords(sentence, signal);
    setRareWords(rareDetails);
    if (autoSave) {
      addToWordbook(cacheKey, {
        definition: translated || '已添加到单词本（句子）',
        source: '句子收藏'
      });
      incrementDailyGoal(1);
    }
  };

  const fetchDefinition = async (word, signal) => {
    const cacheKey = normalize(word);
    if (cacheRef.current.definitions[cacheKey]) {
      return cloneDefinitionPayload(cacheRef.current.definitions[cacheKey]);
    }

    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await fetchWithTimeout(url, { signal });
    if (!res.ok) {
      return { definitions: [], primaryDefinition: '' };
    }

    const data = await res.json();
    const normalizedData = Array.isArray(data) ? data : [];
    const defs = normalizedData.map((item) => ({
      word: item.word,
      phonetic: item.phonetic,
      meanings: item.meanings || []
    }));

    const primary = normalizedData[0]?.meanings?.[0]?.definitions?.[0]?.definition || '';
    const payload = { definitions: defs, primaryDefinition: primary };
    cacheRef.current.definitions[cacheKey] = payload;
    return cloneDefinitionPayload(payload);
  };

  const fetchTranslation = async (sentence, signal) => {
    const cacheKey = sentence.trim().toLowerCase();
    if (cacheRef.current.translations[cacheKey]) {
      return cacheRef.current.translations[cacheKey];
    }

    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(sentence)}&langpair=en|zh-CN`;
    const res = await fetchWithTimeout(url, { signal });
    if (!res.ok) return '翻译暂不可用';

    const data = await res.json();
    const translated = data?.responseData?.translatedText || '翻译暂不可用';
    cacheRef.current.translations[cacheKey] = translated;
    return translated;
  };

  const findRareWords = async (sentence, signal) => {
    const tokens = (sentence.toLowerCase().match(/[a-z']+/g) || []).filter(Boolean);
    const unique = Array.from(new Set(tokens));
    const rare = unique.filter((token) => !COMMON_WORDS.has(token) && token.length > 2).slice(0, 5);

    const details = await Promise.all(
      rare.map(async (word) => {
        try {
          const { definitions } = await fetchDefinition(word, signal);
          const firstMeaning = definitions[0]?.meanings?.[0];
          const baseDefinition = firstMeaning?.definitions?.[0];
          return {
            word,
            pos: firstMeaning?.partOfSpeech,
            meaning: baseDefinition?.definition || '暂未获取到释义',
            example: baseDefinition?.example,
            synonyms: (firstMeaning?.synonyms || []).slice(0, 4)
          };
        } catch (err) {
          if (err.name === 'AbortError') {
            throw err;
          }
          console.warn('获取低频词失败', err);
          return {
            word,
            meaning: '暂未获取到释义',
            synonyms: [],
            example: undefined
          };
        }
      })
    );

    return details;
  };

  const addToWordbook = (word, payload = {}) => {
    const normalizedWord = normalize(word);
    if (!normalizedWord) return;

    setWordbook((prev) => {
      const existing = prev.find((item) => item.word === normalizedWord);
      const nextEntry = {
        word: normalizedWord,
        definition: cleanDefinition(payload.definition || existing?.definition || ''),
        phonetic: payload.phonetic || existing?.phonetic || '',
        addedAt: existing?.addedAt || Date.now(),
        source: payload.source || existing?.source || '单词收藏',
        note: payload.note || existing?.note || '',
        tags: Array.isArray(payload.tags) ? payload.tags : existing?.tags || [],
        stats: ensureStats(existing?.stats)
      };

      if (existing) {
        return prev.map((item) => (item.word === normalizedWord ? nextEntry : item));
      }
      return [...prev, nextEntry];
    });
  };

  const parseBatchWords = (input) => {
    const tokens = input
      .split(/[\n,;，；]+/)
      .map((item) => normalize(item.replace(/[^a-zA-Z'-]/g, ' ')))
      .map((item) => item.trim())
      .filter(Boolean);
    return Array.from(new Set(tokens));
  };

  const handleBatchImport = async () => {
    const words = parseBatchWords(batchText);
    if (!words.length) {
      setBatchStatus({ total: 0, processed: 0, message: '请输入要导入的单词（换行或逗号分隔）。' });
      return;
    }

    setBatchLoading(true);
    setBatchStatus({ total: words.length, processed: 0, message: '正在批量获取释义...' });

    for (let i = 0; i < words.length; i += 1) {
      const current = words[i];
      try {
        const result = await fetchDefinition(current);
        const primary = result.primaryDefinition || '待补充释义';
        addToWordbook(current, {
          definition: primary,
          phonetic: result.definitions[0]?.phonetic,
          source: '批量导入'
        });
      } catch (err) {
        console.warn(`批量导入失败: ${current}`, err);
      } finally {
        setBatchStatus((prev) => ({ ...prev, processed: i + 1 }));
      }
    }

    setBatchLoading(false);
    setBatchStatus((prev) => ({
      ...prev,
      message: '批量导入完成，可在单词本和测试区查看。',
      processed: prev.total
    }));
  };

  const recordTestResult = (word, isCorrect) => {
    setWordbook((prev) =>
      prev.map((item) => {
        if (item.word !== word) return item;
        const stats = ensureStats(item.stats);
        const nextStreak = isCorrect ? stats.streak + 1 : 0;
        const step = Math.min(REVIEW_STEPS[nextStreak] || REVIEW_STEPS[REVIEW_STEPS.length - 1], 21);
        const nextReview = Date.now() + step * 24 * 60 * 60 * 1000;
        const updatedStats = {
          ...stats,
          tests: stats.tests + 1,
          correct: stats.correct + (isCorrect ? 1 : 0),
          streak: nextStreak,
          lastTested: Date.now(),
          nextReview
        };
        return { ...item, stats: updatedStats };
      })
    );
  };

  const buildQuizQuestions = () => {
    const candidates = wordbook.filter((item) => cleanDefinition(item.definition).length >= 3);
    if (candidates.length < 3) {
      return [];
    }
    const pool = shuffle(candidates).slice(0, Math.min(QUIZ_SIZE, candidates.length));
    const definitionPool = candidates.map((item) => cleanDefinition(item.definition));

    return pool.map((item) => {
      const correct = cleanDefinition(item.definition);
      const distractors = shuffle(definitionPool.filter((d) => d !== correct)).slice(0, 3);
      while (distractors.length < 3) {
        distractors.push('记住发音或例句，这一项靠你！');
      }
      const options = shuffle([correct, ...distractors.slice(0, 3)]);
      return {
        word: item.word,
        phonetic: item.phonetic,
        correct,
        options
      };
    });
  };

  const incrementDailyGoal = (step = 1) => {
    setDailyGoal((prev) => {
      const today = TODAY();
      if (prev.date !== today) {
        return { target: prev.target || 15, completed: Math.min(step, prev.target || 15), date: today };
      }
      const nextCompleted = Math.min((prev.completed || 0) + step, prev.target || 15);
      return { ...prev, completed: nextCompleted };
    });
  };

  const startQuiz = () => {
    const questions = buildQuizQuestions();
    if (!questions.length) {
      setQuizError('单词本至少需要 3 个带释义的词才能生成测试。');
      return;
    }
    setQuizError('');
    setQuizState({
      active: true,
      finished: false,
      current: 0,
      score: 0,
      questions
    });
  };

  const answerQuestion = (option) => {
    setQuizState((prev) => {
      const currentQuestion = prev.questions[prev.current];
      const isCorrect = option === currentQuestion.correct;
      recordTestResult(currentQuestion.word, isCorrect);

      setMissedWords((missed) => {
        const exists = missed.includes(currentQuestion.word);
        if (!isCorrect && !exists) return [...missed, currentQuestion.word];
        if (isCorrect && exists) return missed.filter((w) => w !== currentQuestion.word);
        return missed;
      });

      if (isCorrect) incrementDailyGoal(1);

      const nextIndex = prev.current + 1;
      const finished = nextIndex >= prev.questions.length;
      return {
        ...prev,
        current: finished ? prev.current : nextIndex,
        score: prev.score + (isCorrect ? 1 : 0),
        finished
      };
    });
  };

  const resetQuiz = () => {
    setQuizState({
      active: false,
      finished: false,
      current: 0,
      score: 0,
      questions: []
    });
    setQuizError('');
  };

  const startMissedQuiz = () => {
    if (!missedWords.length) {
      setQuizError('暂时没有错题可复习。');
      return;
    }
    const candidates = wordbook.filter((item) => missedWords.includes(item.word));
    if (!candidates.length) {
      setQuizError('错题未在当前单词本中，先补充释义。');
      return;
    }
    const questions = candidates.map((item) => ({
      word: item.word,
      phonetic: item.phonetic,
      correct: cleanDefinition(item.definition) || '已收藏',
      options: shuffle([
        cleanDefinition(item.definition) || '已收藏',
        '关注发音和搭配，多读几遍。',
        '试着造句并背诵。',
        '想想它的同义词或反义词。'
      ])
    }));
    setQuizError('');
    setQuizState({
      active: true,
      finished: false,
      current: 0,
      score: 0,
      questions
    });
  };

  const buildFlashQueue = (items) => {
    const sorted = [...items].sort((a, b) => {
      const streakA = a.stats?.streak || 0;
      const streakB = b.stats?.streak || 0;
      if (streakA === streakB) {
        return (a.stats.nextReview || 0) - (b.stats.nextReview || 0);
      }
      return streakA - streakB;
    });
    return shuffle(sorted).slice(0, Math.min(14, sorted.length));
  };

  const handleFlashReveal = () => {
    setFlashState((prev) => ({ ...prev, reveal: !prev.reveal }));
  };

  const handleFlashNext = () => {
    setFlashState((prev) => {
      if (!prev.queue.length) return prev;
      return {
        ...prev,
        index: (prev.index + 1) % prev.queue.length,
        reveal: false
      };
    });
  };

  const handleManualAdd = () => {
    if (!manualWord.trim()) return;
    const tags = manualTags
      .split(/[,，;]/)
      .map((t) => t.trim())
      .filter(Boolean);
    addToWordbook(manualWord, {
      definition: manualDefinition || '已收藏（手动）',
      source: '手动添加',
      tags
    });
    incrementDailyGoal(1);
    setManualWord('');
    setManualDefinition('');
    setManualTags('');
    setToast('已添加到单词本');
  };

  const handleExport = () => {
    try {
      const data = JSON.stringify(wordbook, null, 2);
      setExportData(data);
      navigator.clipboard?.writeText(data).catch(() => {});
      setToast('已生成导出数据');
    } catch (err) {
      console.warn('导出失败', err);
    }
  };

  const handleImport = () => {
    if (!importText.trim()) return;
    try {
      const parsed = JSON.parse(importText);
      if (!Array.isArray(parsed)) throw new Error('格式需为数组');
      const migrated = migrateWordbook(parsed);
      setWordbook((prev) => {
        const merged = [...prev];
        migrated.forEach((item) => {
          const existing = merged.find((m) => m.word === item.word);
          if (existing) {
            merged.splice(
              merged.findIndex((m) => m.word === item.word),
              1,
              { ...existing, ...item }
            );
          } else {
            merged.push(item);
          }
        });
        return merged;
      });
      setImportText('');
      setToast('导入成功');
    } catch (err) {
      setToast('导入失败，请检查 JSON 格式');
    }
  };

  const toggleTag = (word, tag) => {
    setWordbook((prev) =>
      prev.map((item) => {
        if (item.word !== word) return item;
        const tags = new Set(item.tags || []);
        if (tags.has(tag)) {
          tags.delete(tag);
        } else {
          tags.add(tag);
        }
        return { ...item, tags: Array.from(tags) };
      })
    );
  };

  const hotSearch = (() => {
    const normalizedWord = normalize(text);
    return (searchCounts[normalizedWord] || 0) >= 3;
  })();

  const currentFlash = flashState.queue[flashState.index];

  const quizProgress = quizState.questions.length
    ? Math.round(
        ((quizState.finished ? quizState.questions.length : quizState.current) / quizState.questions.length) * 100
      )
    : 0;

  const tagsSet = useMemo(() => {
    const set = new Set();
    wordbook.forEach((w) => (w.tags || []).forEach((t) => set.add(t)));
    return Array.from(set);
  }, [wordbook]);

  const renderDefinition = (entry) => (
    <div className="card fade-in" key={entry.word}>
      <div className="card-header">
        <div className="word-head">
          <span className="word">{entry.word}</span>
          {entry.phonetic ? <span className="phonetic">[{entry.phonetic}]</span> : null}
        </div>
      </div>
      <div className="card-body">
        {entry.meanings?.map((meaning, idx) => (
          <div className="meaning" key={`${entry.word}-${meaning.partOfSpeech}-${idx}`}>
            <div className="pos">{meaning.partOfSpeech}</div>
            <ul className="definitions">
              {(meaning.definitions || []).slice(0, 3).map((def, defIdx) => (
                <li key={`${entry.word}-${idx}-${defIdx}`}>
                  <div className="definition-text">{def.definition}</div>
                  {def.example ? <div className="example">例句：{def.example}</div> : null}
                  {def.synonyms?.length ? (
                    <div className="synonyms">同义：{def.synonyms.slice(0, 4).join(', ')}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">LumenWords · 词典 / 记忆 / 测验 / 闪卡 / 导入导出</p>
          <h1 className="title-glow">光谱词库 v1.0</h1>
          <p className="subtitle">
            查询释义、翻译句子、批量导入单词，支持闪卡、测验、错题重练、标记标签与导入导出。无需 API Key，数据自动持久化。
          </p>
          <div className="daily">
            <div className="daily-head">
              <span>今日目标 {dailyGoal.completed}/{dailyGoal.target}</span>
              <div className="chips">
                <button className="ghost tiny" onClick={() => setDailyGoal(hydrateDailyGoal({ target: dailyGoal.target }))}>
                  重置今日
                </button>
                <button
                  className="ghost tiny"
                  onClick={() => setDailyGoal((p) => ({ ...p, target: Math.max(5, (p.target || 15) + 5), date: TODAY() }))}
                >
                  提升目标
                </button>
              </div>
            </div>
            <div className="progress animated">
              <div className="bar" style={{ width: `${dailyProgress}%` }} />
              <span>完成度 {dailyProgress}%</span>
            </div>
          </div>
        </div>
        <div className="badge pop">桌面记单词</div>
      </header>

      <main className="content">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="tag">{isSentence ? '句子模式' : '单词模式'}</div>
              <h2>查询 / 翻译</h2>
              <p className="muted">回车或点击开始，支持自动收藏与低频词提取。</p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className={`search-bar ${hotSearch ? 'hot' : ''}`}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="输入英文单词或句子…"
            />
            <button type="submit" disabled={loading}>
              {loading ? '请求中…' : '查询'}
            </button>
          </form>
          {hotSearch ? <div className="hint hot-hint">该词已查询多次，已自动标记并加入单词本。</div> : null}
          {error ? <div className="hint error">{error}</div> : null}
        </section>

        <section className="grid">
          <div className="column">
            <div className="panel">
              <div className="panel-head">
                <h3>牛津风格释义</h3>
                <span className="muted">dictionaryapi.dev</span>
              </div>
              {!isSentence && !definitions.length && !loading ? (
                <div className="placeholder">输入单词后显示释义。</div>
              ) : null}
              {!isSentence ? definitions.map(renderDefinition) : null}
            </div>
          </div>

          <div className="column">
            <div className="panel">
              <div className="panel-head">
                <h3>翻译 & 低频词</h3>
                <span className="muted">MyMemory 翻译</span>
              </div>
              {isSentence ? (
                <>
                  <div className="card fade-in">
                    <div className="card-body">
                      <div className="label">翻译</div>
                      <div className="definition-text">{translation || '等待翻译结果…'}</div>
                    </div>
                  </div>

                  <div className="card fade-in">
                    <div className="card-body">
                      <div className="label">低频词解析</div>
                      {rareWords.length === 0 ? (
                        <div className="placeholder">自动提取低频词后显示释义、例句和同义词。</div>
                      ) : (
                        <ul className="rare-list">
                          {rareWords.map((item) => (
                            <li key={item.word}>
                              <div className="rare-word">
                                <span className="word">{item.word}</span>
                                {item.pos ? <span className="pos-tag">{item.pos}</span> : null}
                              </div>
                              <div className="definition-text">{item.meaning}</div>
                              {item.example ? <div className="example">例句：{item.example}</div> : null}
                              {item.synonyms?.length ? (
                                <div className="synonyms">同义：{item.synonyms.join(', ')}</div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="placeholder">输入句子后将显示翻译与低频词。</div>
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="tag">批量导入 & 手动收藏</div>
              <h3>一键收录多个单词</h3>
              <p className="muted">换行或逗号分隔；自动抓取释义并加入单词本。</p>
            </div>
            <button className="ghost" onClick={handleBatchImport} disabled={batchLoading}>
              {batchLoading ? '导入中…' : '开始导入'}
            </button>
          </div>
          <textarea
            className="batch-textarea"
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
            placeholder="例如：serendipity, meticulous, resilient, empathy..."
            rows={4}
          />
          {batchStatus.message ? (
            <div className="hint">
              {batchStatus.message} {batchStatus.processed}/{batchStatus.total}
            </div>
          ) : null}
          <div className="manual">
            <div>
              <div className="tag">手动收藏</div>
              <p className="muted">快速添加词条与标签，补充释义可留空。</p>
            </div>
            <div className="manual-form">
              <input
                value={manualWord}
                onChange={(e) => setManualWord(e.target.value)}
                placeholder="单词"
              />
              <input
                value={manualDefinition}
                onChange={(e) => setManualDefinition(e.target.value)}
                placeholder="自定义释义（可选）"
              />
              <input
                value={manualTags}
                onChange={(e) => setManualTags(e.target.value)}
                placeholder="标签（逗号分隔，可选）"
              />
              <button className="ghost" onClick={handleManualAdd}>
                添加
              </button>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="tag">单词本</div>
              <h3>随时回顾与标注</h3>
              <p className="muted">自动收藏、批量导入或手动添加的词都会出现在这里。</p>
            </div>
            <div className="pill">
              已收录 <strong>{wordbook.length}</strong> 个词
            </div>
          </div>
          <div className="filters">
            <input
              placeholder="按词/释义/笔记搜索"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
            <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
              <option value="">全部标签</option>
              {tagsSet.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>
          {filteredWordbook.length === 0 ? (
            <div className="placeholder">还没有收藏的词语，先查询或批量导入吧。</div>
          ) : (
            <div className="wordbook">
              {filteredWordbook
                .slice()
                .reverse()
                .map((item) => (
                  <div className="wordbook-item fade-in" key={`${item.word}-${item.addedAt}`}>
                    <div className="wordbook-title">
                      <div className="word-line">
                        <span className="word">{item.word}</span>
                        {item.phonetic ? <span className="phonetic">[{item.phonetic}]</span> : null}
                      </div>
                      <span className="timestamp">
                        {new Date(item.addedAt).toLocaleString('zh-CN', { hour12: false })}
                      </span>
                    </div>
                    <div className="definition-text">{item.definition || '已收藏'}</div>
                    <div className="meta-row">
                      <span className="meta">来源：{item.source}</span>
                      <span className="meta">
                        正确率：{item.stats.tests ? Math.round((item.stats.correct / item.stats.tests) * 100) : 0}%
                      </span>
                      <span className="meta">连对：{item.stats.streak}</span>
                      <span className="meta">
                        下次复习：{item.stats.nextReview ? new Date(item.stats.nextReview).toLocaleDateString('zh-CN') : '待安排'}
                      </span>
                    </div>
                    <div className="chips">
                      {(item.tags || []).map((tag) => (
                        <span className="chip" key={tag} onClick={() => setFilterTag(tag)}>
                          #{tag}
                        </span>
                      ))}
                      <button className="ghost tiny" onClick={() => toggleTag(item.word, '常考')}>
                        常考
                      </button>
                      <button className="ghost tiny" onClick={() => toggleTag(item.word, '易错')}>
                        易错
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>

        <section className="panel section-grid">
          <div className="panel sub">
            <div className="panel-head">
              <div>
                <div className="tag">闪卡复习</div>
                <h3>翻转记忆</h3>
                <p className="muted">优先出现低连对、久未测试的词，点击翻转释义。</p>
              </div>
              <button
                className="ghost"
                onClick={() => setFlashState({ queue: buildFlashQueue(wordbook), index: 0, reveal: false })}
              >
                重新生成
              </button>
            </div>
            {!flashState.queue.length ? (
              <div className="placeholder">添加一些词后，自动生成闪卡队列。</div>
            ) : (
              <div className="flashcard animate-pop" onClick={handleFlashReveal}>
                <div className={`flash-inner ${flashState.reveal ? 'reveal' : ''}`}>
                  <div className="flash-face front">
                    <div className="label">词面</div>
                    <h4>
                      {currentFlash?.word}
                      {currentFlash?.phonetic ? <span className="phonetic">[{currentFlash.phonetic}]</span> : null}
                    </h4>
                    <div className="meta">连对 {currentFlash?.stats?.streak || 0}</div>
                  </div>
                  <div className="flash-face back">
                    <div className="label">释义</div>
                    <div className="definition-text">{currentFlash?.definition || '点击翻面'}</div>
                    <div className="meta">
                      下次复习：
                      {currentFlash?.stats?.nextReview
                        ? new Date(currentFlash.stats.nextReview).toLocaleDateString('zh-CN')
                        : '待安排'}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="flash-actions">
              <button className="ghost" onClick={handleFlashReveal}>
                翻转
              </button>
              <button className="ghost" onClick={handleFlashNext}>
                下一个
              </button>
            </div>
          </div>

          <div className="panel sub">
            <div className="panel-head">
              <div>
                <div className="tag">测试模式</div>
                <h3>快速测验</h3>
                <p className="muted">基于单词本自动生成四选一测试，巩固记忆。</p>
              </div>
              <div className="quiz-actions">
                <button className="ghost" onClick={startQuiz}>
                  重新生成
                </button>
                <button className="ghost" onClick={resetQuiz}>
                  重置
                </button>
                <button className="ghost" onClick={startMissedQuiz}>
                  错题重测
                </button>
              </div>
            </div>
            {quizError ? <div className="hint error">{quizError}</div> : null}
            {!quizState.active ? (
              <div className="placeholder">点击“重新生成”开始一轮 7 题测验。</div>
            ) : null}

            {quizState.active && quizState.questions.length ? (
              <div className="quiz">
                <div className="progress animated">
                  <div className="bar" style={{ width: `${quizProgress}%` }} />
                  <span>
                    进度 {quizState.finished ? quizState.questions.length : quizState.current}/{quizState.questions.length} ·
                    得分 {quizState.score}
                  </span>
                </div>
                {!quizState.finished ? (
                  <>
                    <div className="quiz-card fade-in">
                      <div className="label">选择正确释义</div>
                      <h4>
                        {quizState.questions[quizState.current].word}
                        {quizState.questions[quizState.current].phonetic ? (
                          <span className="phonetic">[{quizState.questions[quizState.current].phonetic}]</span>
                        ) : null}
                      </h4>
                    </div>
                    <div className="options">
                      {quizState.questions[quizState.current].options.map((option, idx) => (
                        <button
                          key={option + idx}
                          className="option"
                          onClick={() => answerQuestion(option)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="placeholder">
                    本轮完成！得分 {quizState.score}/{quizState.questions.length}，点击“重新生成”开始下一轮。
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel section-grid">
          <div className="panel sub">
            <div className="panel-head">
              <div>
                <div className="tag">复习清单</div>
                <h3>今日优先</h3>
                <p className="muted">按下次复习时间排序，优先复习冷却中的词。</p>
              </div>
            </div>
            {reviewList.length === 0 ? (
              <div className="placeholder">添加一些词后，这里会出现待复习清单。</div>
            ) : (
              <ul className="review-list">
                {reviewList.map((item) => (
                  <li key={item.word} className="review-item fade-in">
                    <div>
                      <div className="word-line">
                        <span className="word">{item.word}</span>
                        {item.phonetic ? <span className="phonetic">[{item.phonetic}]</span> : null}
                      </div>
                      <div className="definition-text small">{item.definition}</div>
                    </div>
                    <div className="meta-col">
                      <span className="meta">
                        下次复习：
                        {item.stats.nextReview
                          ? new Date(item.stats.nextReview).toLocaleDateString('zh-CN')
                          : '待安排'}
                      </span>
                      <span className="meta">连对 {item.stats.streak}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel sub">
            <div className="panel-head">
              <div>
                <div className="tag">错题再练</div>
                <h3>优先攻克短板</h3>
                <p className="muted">错题列表会随测验更新，可直接点击再次测验。</p>
              </div>
            </div>
            {missedWords.length === 0 ? (
              <div className="placeholder">暂无错题，继续保持！</div>
            ) : (
              <div className="missed-grid">
                {missedWords.map((word) => (
                  <div className="missed-card fade-in" key={word}>
                    <div className="word-line">
                      <span className="word">{word}</span>
                      <button className="ghost tiny" onClick={() => setText(word)}>
                        填入查询
                      </button>
                    </div>
                    <button className="ghost tiny" onClick={startMissedQuiz}>
                      立即重测
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel sub">
            <div className="panel-head">
              <div>
                <div className="tag">导入导出</div>
                <h3>备份 / 迁移</h3>
                <p className="muted">JSON 格式导入导出，支持跨设备迁移。</p>
              </div>
              <div className="chips">
                <button className="ghost tiny" onClick={handleExport}>
                  生成导出
                </button>
                <button className="ghost tiny" onClick={handleImport}>
                  导入
                </button>
              </div>
            </div>
            <textarea
              className="batch-textarea"
              value={exportData}
              onChange={(e) => setExportData(e.target.value)}
              placeholder="点击生成导出数据，自动复制到剪贴板"
              rows={3}
            />
            <textarea
              className="batch-textarea"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="粘贴要导入的 JSON 数组"
              rows={3}
            />
          </div>
        </section>
      </main>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

export default App;

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

const STORAGE_KEYS = {
  counts: 'word_search_counts',
  wordbook: 'wordbook_entries_v2'
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
  lastTested: stats.lastTested || 0
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

  const cacheRef = useRef({ definitions: {}, translations: {} });
  const requestControllerRef = useRef(null);

  const isSentence = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    return /\s/.test(trimmed);
  }, [text]);

  const reviewList = useMemo(() => {
    const sorted = [...wordbook].sort((a, b) => (a.stats.lastTested || 0) - (b.stats.lastTested || 0));
    return sorted.slice(0, 6);
  }, [wordbook]);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        if (window.persist?.loadData) {
          const data = await window.persist.loadData();
          if (cancelled) return;
          if (data?.wordbook) setWordbook(migrateWordbook(data.wordbook));
          if (data?.searchCounts) setSearchCounts(data.searchCounts);
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
    const payload = { wordbook, searchCounts };
    if (window.persist?.saveData) {
      window.persist.saveData(payload).catch((err) => console.warn('写入本地进度失败', err));
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.wordbook, JSON.stringify(wordbook));
      window.localStorage.setItem(STORAGE_KEYS.counts, JSON.stringify(searchCounts));
    } catch (err) {
      console.warn('写入 localStorage 失败', err);
    }
  }, [wordbook, searchCounts, hydrated]);

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
        const updatedStats = {
          ...stats,
          tests: stats.tests + 1,
          correct: stats.correct + (isCorrect ? 1 : 0),
          streak: isCorrect ? stats.streak + 1 : 0,
          lastTested: Date.now()
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

  const hotSearch = (() => {
    const normalizedWord = normalize(text);
    return (searchCounts[normalizedWord] || 0) >= 3;
  })();

  const renderDefinition = (entry) => (
    <div className="card" key={entry.word}>
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

  const quizProgress = quizState.questions.length
    ? Math.round(((quizState.finished ? quizState.questions.length : quizState.current) /
        quizState.questions.length) *
        100)
    : 0;

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">LumenWords · 词典 / 记忆 / 测试</p>
          <h1>光谱词库</h1>
          <p className="subtitle">
            查询释义、翻译句子、批量导入单词，并用测验巩固记忆。所有功能均为中文界面，适合自学与复盘。
          </p>
        </div>
        <div className="badge">桌面记单词</div>
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
                  <div className="card">
                    <div className="card-body">
                      <div className="label">翻译</div>
                      <div className="definition-text">{translation || '等待翻译结果…'}</div>
                    </div>
                  </div>

                  <div className="card">
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
              <div className="tag">批量导入</div>
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
          {wordbook.length === 0 ? (
            <div className="placeholder">还没有收藏的词语，先查询或批量导入吧。</div>
          ) : (
            <div className="wordbook">
              {wordbook
                .slice()
                .reverse()
                .map((item) => (
                  <div className="wordbook-item" key={`${item.word}-${item.addedAt}`}>
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
                        测试正确率：{item.stats.tests ? Math.round((item.stats.correct / item.stats.tests) * 100) : 0}%
                      </span>
                      <span className="meta">连对：{item.stats.streak}</span>
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
                <div className="tag">复习清单</div>
                <h3>今日优先</h3>
                <p className="muted">按最近测试时间排序，优先复习冷却中的词。</p>
              </div>
            </div>
            {reviewList.length === 0 ? (
              <div className="placeholder">添加一些词后，这里会出现待复习清单。</div>
            ) : (
              <ul className="review-list">
                {reviewList.map((item) => (
                  <li key={item.word} className="review-item">
                    <div>
                      <div className="word-line">
                        <span className="word">{item.word}</span>
                        {item.phonetic ? <span className="phonetic">[{item.phonetic}]</span> : null}
                      </div>
                      <div className="definition-text small">{item.definition}</div>
                    </div>
                    <div className="meta-col">
                      <span className="meta">
                        最近测试：
                        {item.stats.lastTested
                          ? new Date(item.stats.lastTested).toLocaleDateString('zh-CN')
                          : '未测试'}
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
              </div>
            </div>
            {quizError ? <div className="hint error">{quizError}</div> : null}
            {!quizState.active ? (
              <div className="placeholder">点击“重新生成”开始一轮 7 题测验。</div>
            ) : null}

            {quizState.active && quizState.questions.length ? (
              <div className="quiz">
                <div className="progress">
                  <div className="bar" style={{ width: `${quizProgress}%` }} />
                  <span>
                    进度 {quizState.finished ? quizState.questions.length : quizState.current}/{quizState.questions.length} ·
                    得分 {quizState.score}
                  </span>
                </div>
                {!quizState.finished ? (
                  <>
                    <div className="quiz-card">
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
      </main>
    </div>
  );
}

export default App;

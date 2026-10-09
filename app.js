const { createClient } = window.supabase;

const hasConfig = !window.SUPABASE_URL.includes('YOUR-PROJECT') &&
  !window.SUPABASE_ANON_KEY.includes('YOUR_BROWSER_SAFE');

const supabase = hasConfig
  ? createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
  : null;

const MAX_POST_LENGTH = 20000;

const state = {
  user: null,
  profile: null,
  isOwner: false,
  authMode: 'login',
  pendingLikes: new Set(),
  likesReady: false,
  posts: []
};

const $ = (id) => document.getElementById(id);
const feed = $('feed');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function protectMath(source) {
  const savedMath = [];
  let text = String(source);

  const stash = (expression, display = false) => {
    const token = `MATHSAFEPLACEHOLDER${savedMath.length}END`;
    savedMath.push({ token, expression });
    return display ? `\n\n${token}\n\n` : token;
  };

  // Protect display math and the usual \(...\) / \[...\] delimiters before
  // Markdown parsing, so underscores and asterisks inside TeX stay untouched.
  text = text.replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g, match => {
    const isDisplay = match.startsWith('$$') || match.startsWith('\\[');
    return stash(match, isDisplay);
  });

  // Single-dollar inline math. Escaped dollar signs and $$ delimiters are excluded.
  text = text.replace(/(?<!\\)\$(?!\$)[^\n$]+(?<!\\)\$(?!\$)/g, match => stash(match));
  return { text, savedMath };
}

function renderMarkdown(source = '') {
  const plainText = String(source);
  if (!window.marked?.parse || !window.DOMPurify?.sanitize) {
    return `<p>${escapeHtml(plainText).replace(/\r?\n/g, '<br>')}</p>`;
  }

  const protectedContent = protectMath(plainText);
  const markdownHtml = window.marked.parse(protectedContent.text, {
    gfm: true,
    breaks: true
  });

  // Markdown output is user content. Sanitize it before putting it into innerHTML.
  let safeHtml = window.DOMPurify.sanitize(markdownHtml, {
    USE_PROFILES: { html: true }
  });

  // Restore TeX as escaped text, preserving math delimiters for MathJax.
  for (const item of protectedContent.savedMath) {
    safeHtml = safeHtml.replaceAll(item.token, escapeHtml(item.expression));
  }
  return safeHtml;
}

let mathJaxPromise = null;
function ensureMathJax() {
  if (window.MathJax?.typesetPromise) return Promise.resolve(window.MathJax);
  if (mathJaxPromise) return mathJaxPromise;

  mathJaxPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = 'mathjax-script';
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@4/tex-chtml.js';
    script.onload = async () => {
      try {
        if (window.MathJax?.startup?.promise) await window.MathJax.startup.promise;
        resolve(window.MathJax || null);
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = () => reject(new Error('MathJax could not be loaded.'));
    document.head.appendChild(script);
  }).catch(error => {
    console.warn(error);
    mathJaxPromise = null;
    return null;
  });

  return mathJaxPromise;
}

function enhancePostContent() {
  const bodies = Array.from(feed.querySelectorAll('.post-body'));
  for (const body of bodies) {
    if (window.hljs) {
      body.querySelectorAll('pre code').forEach(block => {
        try { window.hljs.highlightElement(block); } catch (error) { console.warn(error); }
      });
    }

    body.querySelectorAll('a[href]').forEach(link => {
      try {
        const url = new URL(link.getAttribute('href'), window.location.href);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
      } catch (_) {
        // Ignore malformed URLs; DOMPurify already filtered unsafe protocols.
      }
    });
  }

  if (bodies.some(body => /\\\(|\\\[|\$/.test(body.textContent || ''))) {
    ensureMathJax().then(mathJax => {
      if (!mathJax?.typesetPromise) return;
      const currentBodies = Array.from(feed.querySelectorAll('.post-body'));
      if (currentBodies.length) {
        mathJax.typesetPromise(currentBodies).catch(error => console.warn('MathJax typesetting failed:', error));
      }
    });
  }
}

function updateCharCount() {
  $('charCount').textContent = `${$('postBody').value.length.toLocaleString()} / ${MAX_POST_LENGTH.toLocaleString()}`;
}

function initial(name = '?') {
  return escapeHtml((name.trim()[0] || '?').toUpperCase());
}

function timeAgo(dateString) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(dateString).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(dateString));
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2400);
}

function setHidden(selector, hidden) {
  document.querySelectorAll(selector).forEach(el => { el.hidden = hidden; });
}

function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

function requireClient() {
  if (!supabase) {
    toast('Add your Supabase values to config.js first.');
    return false;
  }
  return true;
}

function renderAuthUI() {
  const signedIn = !!state.user;
  setHidden('.owner-only', !state.isOwner);
  $('openAuth').hidden = signedIn;
  $('signOut').hidden = !signedIn;
  $('openAuth').textContent = signedIn ? state.profile?.display_name || state.user.email : 'Sign in';
}

function renderFeed() {
  if (window.MathJax?.typesetClear) window.MathJax.typesetClear([feed]);
  if (!state.posts.length) {
    feed.innerHTML = '<div class="empty-card">Nothing here yet. The first post is waiting.</div>';
    return;
  }

  feed.innerHTML = state.posts.map(post => {
    const profile = post.profile || {};
    const canDelete = state.isOwner || state.user?.id === post.author_id;
    const liked = Boolean(post.likedByMe);
    const likeCount = Number(post.likeCount || 0);
    const likePending = state.pendingLikes.has(post.id);
    return `
      <article class="post-card">
        <div class="post-top">
          <div class="post-meta">
            <div class="avatar">${initial(profile.display_name || 'u')}</div>
            <div>
              <div class="author-line">
                <span class="author">${escapeHtml(profile.display_name || 'user')}</span>
                ${profile.username ? `<span class="handle">@${escapeHtml(profile.username)}</span>` : ''}
                <span class="post-time">· ${escapeHtml(timeAgo(post.created_at))}</span>
              </div>
            </div>
          </div>
          ${canDelete ? `<button class="action-button danger" data-delete-post="${post.id}">Delete</button>` : ''}
        </div>
        <div class="post-body">${renderMarkdown(post.body)}</div>
        <div class="post-actions">
          <button class="action-button like-button ${liked ? 'liked' : ''}" data-like-post="${post.id}" aria-pressed="${liked}" aria-label="${liked ? 'Unlike' : 'Like'} this note" title="${state.likesReady ? (state.user ? (liked ? 'Remove your like' : 'Like this note') : 'Sign in to like this note') : 'Likes need to be set up in Supabase'}" ${likePending || !state.likesReady ? 'disabled' : ''}>
            <span class="like-icon" aria-hidden="true">${liked ? '♥' : '♡'}</span>
            <span class="like-label">${liked ? 'Liked' : 'Like'}</span>
            <span class="like-count">${likeCount}</span>
          </button>
        </div>
      </article>`;
  }).join('');
  enhancePostContent();
}

async function loadPosts() {
  if (!requireClient()) return;
  feed.innerHTML = '<div class="loading-card"><div class="spinner"></div><span>Loading the feed…</span></div>';

  const { data: postsData, error } = await supabase
    .from('posts')
    .select(`
      id,
      author_id,
      body,
      created_at,
      profile:profiles!posts_author_id_fkey(display_name,username)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    feed.innerHTML = `<div class="error-card">Could not load the feed.<br><small>${escapeHtml(error.message)}</small></div>`;
    return;
  }

  const rows = postsData || [];
  if (!rows.length) {
    state.posts = [];
    state.likesReady = true;
    renderFeed();
    return;
  }

  const { data: likeRows, error: likesError } = await supabase
    .from('post_likes')
    .select('post_id,user_id')
    .in('post_id', rows.map(post => post.id));

  if (likesError) {
    // Keep the public feed readable if the one-time likes table setup has not been run.
    state.likesReady = false;
    state.posts = rows.map(post => ({ ...post, likeCount: 0, likedByMe: false }));
    renderFeed();
    toast('Likes need a one-time setup in Supabase. See the SQL instructions.');
    console.warn('Could not load post likes:', likesError.message);
    return;
  }

  const likeCounts = new Map();
  const likedPostIds = new Set();
  for (const like of (likeRows || [])) {
    likeCounts.set(like.post_id, (likeCounts.get(like.post_id) || 0) + 1);
    if (state.user && like.user_id === state.user.id) likedPostIds.add(like.post_id);
  }

  state.likesReady = true;
  state.posts = rows.map(post => ({
    ...post,
    likeCount: likeCounts.get(post.id) || 0,
    likedByMe: likedPostIds.has(post.id)
  }));
  renderFeed();
}

async function loadIdentity() {
  if (!requireClient()) return;
  const { data: { session } } = await supabase.auth.getSession();
  state.user = session?.user || null;
  state.profile = null;
  state.isOwner = false;
  if (state.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, display_name, username, role')
      .eq('id', state.user.id)
      .maybeSingle();
    state.profile = profile;
    state.isOwner = profile?.role === 'owner';
  }
  renderAuthUI();
  if (state.user) closeModal('authModal');
  await loadPosts();
}

async function publishPost() {
  if (!requireClient()) return;
  if (!state.isOwner) return toast('Only the site owner can publish posts.');
  const body = $('postBody').value.trim();
  $('composerError').textContent = '';
  if (!body) return;
  if (body.length > MAX_POST_LENGTH) {
    $('composerError').textContent = `Posts can be up to ${MAX_POST_LENGTH.toLocaleString()} characters.`;
    return;
  }

  $('publishPost').disabled = true;
  const { error } = await supabase.from('posts').insert({ author_id: state.user.id, body });
  $('publishPost').disabled = false;
  if (error) {
    $('composerError').textContent = error.message;
    return;
  }
  $('postBody').value = '';
  updateCharCount();
  closeModal('composerModal');
  toast('Published.');
  await loadPosts();
}

async function deletePost(id) {
  if (!requireClient()) return;
  if (!confirm('Delete this post?')) return;
  const { error } = await supabase.from('posts').delete().eq('id', id);
  if (error) return toast(error.message);
  toast('Post deleted.');
  await loadPosts();
}

async function toggleLike(postId) {
  if (!requireClient()) return;
  if (!state.user) {
    toast('Sign in to like notes.');
    openModal('authModal');
    return;
  }
  if (!state.likesReady || state.pendingLikes.has(postId)) return;

  const post = state.posts.find(item => item.id === postId);
  if (!post) return;

  const removingLike = post.likedByMe;
  state.pendingLikes.add(postId);
  renderFeed();

  const result = removingLike
    ? await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', state.user.id)
    : await supabase.from('post_likes').insert({ post_id: postId, user_id: state.user.id });

  state.pendingLikes.delete(postId);
  if (result.error) {
    toast(result.error.message);
    await loadPosts();
    return;
  }

  await loadPosts();
}

function setAuthMode(mode) {
  state.authMode = mode;
  $('loginTab').classList.toggle('active', mode === 'login');
  $('signupTab').classList.toggle('active', mode === 'signup');
  $('authTitle').textContent = mode === 'login' ? 'Sign in to join the conversation.' : 'Make yourself a little account.';
  $('authSubmit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  $('displayNameField').hidden = mode === 'login';
  $('authMessage').textContent = '';
  $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
}

async function handleAuth(event) {
  event.preventDefault();
  if (!requireClient()) return;
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const displayName = $('displayName').value.trim();
  const submit = $('authSubmit');
  submit.disabled = true;
  $('authMessage').textContent = '';

  let result;
  if (state.authMode === 'login') {
    result = await supabase.auth.signInWithPassword({ email, password });
  } else {
    result = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName || email.split('@')[0] } }
    });
  }

  submit.disabled = false;
  if (result.error) {
    $('authMessage').textContent = result.error.message;
    return;
  }

  if (state.authMode === 'signup' && !result.data.session) {
    $('authMessage').textContent = 'Check your email to confirm your account, then come back and sign in.';
    return;
  }

  $('authForm').reset();
  await loadIdentity();
  closeModal('authModal');
  toast(state.authMode === 'login' ? 'Signed in.' : 'Account created.');
}

function wireEvents() {
  $('openComposer').addEventListener('click', () => openModal('composerModal'));
  $('mobileCompose').addEventListener('click', () => openModal('composerModal'));
  $('heroCompose').addEventListener('click', () => openModal('composerModal'));
  $('openAuth').addEventListener('click', () => openModal('authModal'));
  $('signOut').addEventListener('click', async () => {
    if (supabase) await supabase.auth.signOut();
    state.user = null; state.profile = null; state.isOwner = false;
    renderAuthUI(); renderFeed(); toast('Signed out.');
  });
  $('refreshFeed').addEventListener('click', loadPosts);
  $('publishPost').addEventListener('click', publishPost);
  $('postBody').addEventListener('input', updateCharCount);
  $('loginTab').addEventListener('click', () => setAuthMode('login'));
  $('signupTab').addEventListener('click', () => setAuthMode('signup'));
  $('authForm').addEventListener('submit', handleAuth);

  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close]');
    if (close) closeModal(close.dataset.close === 'auth' ? 'authModal' : 'composerModal');

    const deletePostButton = event.target.closest('[data-delete-post]');
    if (deletePostButton) deletePost(deletePostButton.dataset.deletePost);

    const likeButton = event.target.closest('[data-like-post]');
    if (likeButton) toggleLike(likeButton.dataset.likePost);
  });
}

async function start() {
  wireEvents();
  setAuthMode('login');
  renderAuthUI();
  if (!supabase) {
    feed.innerHTML = '<div class="error-card">Setup needed: copy <code>config.example.js</code> to <code>config.js</code> and add your Supabase project URL + browser-safe key.</div>';
    return;
  }
  supabase.auth.onAuthStateChange(() => loadIdentity());
  await loadIdentity();
}

start();
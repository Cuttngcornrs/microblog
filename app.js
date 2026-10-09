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
  expandedComments: new Set(),
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

function renderComments(post) {
  const expanded = state.expandedComments.has(post.id);
  if (!expanded) return '';

  const comments = post.comments || [];
  const list = comments.length
    ? comments.map(comment => `
        <div class="comment">
          <div class="comment-main">
            <div class="comment-author">${escapeHtml(comment.profile?.display_name || 'user')}</div>
            <div class="comment-body">${escapeHtml(comment.body)}</div>
          </div>
          ${(state.isOwner || state.user?.id === comment.user_id)
            ? `<button class="comment-delete" data-delete-comment="${comment.id}" aria-label="Delete comment">×</button>` : ''}
        </div>`).join('')
    : '<div class="comment"><div class="comment-body">No comments yet.</div></div>';

  const form = state.user
    ? `<form class="comment-form" data-comment-post="${post.id}">
         <input name="body" maxlength="280" placeholder="Write a reply…" required>
         <button class="action-button" type="submit">Post</button>
       </form>`
    : '<button class="action-button" data-login-comment>Sign in to comment</button>';

  return `<div class="comments">${list}${form}</div>`;
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
    const commentsCount = (post.comments || []).length;
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
          <button class="action-button" data-toggle-comments="${post.id}">${expandedLabel(state.expandedComments.has(post.id), commentsCount)}</button>
        </div>
        ${renderComments(post)}
      </article>`;
  }).join('');
  enhancePostContent();
}

function expandedLabel(expanded, count) {
  if (expanded) return `Hide comments ${count ? `(${count})` : ''}`;
  return `Comments ${count ? `(${count})` : ''}`;
}

async function loadPosts() {
  if (!requireClient()) return;
  feed.innerHTML = '<div class="loading-card"><div class="spinner"></div><span>Loading the feed…</span></div>';

  const { data, error } = await supabase
    .from('posts')
    .select(`
      id,
      author_id,
      body,
      created_at,
      profile:profiles!posts_author_id_fkey(display_name,username),
      comments(
        id,
        user_id,
        body,
        created_at,
        profile:profiles!comments_user_id_fkey(display_name,username)
      )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    feed.innerHTML = `<div class="error-card">Could not load the feed.<br><small>${escapeHtml(error.message)}</small></div>`;
    return;
  }

  state.posts = data || [];
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
  else state.expandedComments.clear();
  renderFeed();
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
  state.expandedComments.delete(id);
  toast('Post deleted.');
  await loadPosts();
}

async function submitComment(postId, body) {
  if (!state.user) return openModal('authModal');
  const { error } = await supabase.from('comments').insert({ post_id: postId, user_id: state.user.id, body });
  if (error) return toast(error.message);
  toast('Reply posted.');
  await loadPosts();
}

async function deleteComment(id) {
  if (!requireClient()) return;
  const { error } = await supabase.from('comments').delete().eq('id', id);
  if (error) return toast(error.message);
  toast('Comment removed.');
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

    const deleteCommentButton = event.target.closest('[data-delete-comment]');
    if (deleteCommentButton) deleteComment(deleteCommentButton.dataset.deleteComment);

    const toggle = event.target.closest('[data-toggle-comments]');
    if (toggle) {
      const id = toggle.dataset.toggleComments;
      if (state.expandedComments.has(id)) state.expandedComments.delete(id);
      else state.expandedComments.add(id);
      renderFeed();
    }

    const loginComment = event.target.closest('[data-login-comment]');
    if (loginComment) openModal('authModal');
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-comment-post]');
    if (!form) return;
    event.preventDefault();
    const input = form.elements.body;
    const body = input.value.trim();
    if (!body) return;
    submitComment(form.dataset.commentPost, body);
    input.value = '';
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
  await loadPosts();
}

start();

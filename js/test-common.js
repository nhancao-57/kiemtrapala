/* Shared student-test lifecycle. No network requests occur until a student submits. */
window.TestCommon = (() => {
  let config;
  let storageOK = true;
  let submitting = false;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  function notice(message) {
    let element = document.getElementById('save-notice');
    if (!element) {
      element = document.createElement('p');
      element.id = 'save-notice';
      element.setAttribute('role', 'status');
      document.querySelector('main').prepend(element);
    }
    element.textContent = message;
  }

  function readState(key, defaults, questionIds) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { ...defaults };
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object' || Array.isArray(saved) || typeof saved.name !== 'string') throw new Error('Invalid saved test');
      const result = { ...defaults, ...saved };
      for (const field of ['answers', 'audioPlays', 'flags']) {
        const value = result[field];
        result[field] = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      }
      const validIds = questionIds && new Set(questionIds.map(String));
      result.answers = Object.fromEntries(Object.entries(result.answers).filter(([id, value]) =>
        (!validIds || validIds.has(id)) && (typeof value === 'string' ||
          ('endTime' in defaults && Array.isArray(value) && value.every(item => typeof item === 'string')))));
      result.isCompleted = saved.isCompleted === true;
      if ('endTime' in defaults && (!Number.isFinite(result.endTime) || result.endTime <= 0)) result.endTime = null;
      return result;
    } catch (error) {
      notice('Không đọc được bài đã lưu. Bạn có thể bắt đầu bài mới.');
      return { ...defaults };
    }
  }

  function saveState(key, state) {
    try {
      localStorage.setItem(key, JSON.stringify(state));
      storageOK = true;
      document.getElementById('save-notice')?.remove();
      return true;
    } catch (error) {
      storageOK = false;
      notice('Không lưu được trên thiết bị này. Hãy giữ trang mở và tải kết quả sau khi nộp bài.');
      return false;
    }
  }

  function clearState(key) {
    try { localStorage.removeItem(key); } catch (error) { storageOK = false; }
  }

  function stopAudio() {
    document.querySelectorAll('audio').forEach(audio => {
      audio.dataset.allowPause = 'true';
      audio.pause();
    });
  }

  function onScreen(screen) {
    document.body.dataset.testScreen = screen;
    if (screen !== 'test') stopAudio();
    document.getElementById('highlight-btn')?.classList.add('hidden');
    if (screen === 'test') {
      const submit = document.getElementById('btn-submit-test');
      submit.disabled = false;
      submit.textContent = 'Nộp bài';
    }
    if (screen === 'start') {
      const state = config.getState();
      document.getElementById('start-form').classList.toggle('hidden', Boolean(state.name && !state.isCompleted));
    }
    if (screen === 'result') renderSubmission();
  }

  function setup(options) {
    config = options;
    document.getElementById('btn-return').addEventListener('click', event => {
      const state = config.getState();
      if (document.body.dataset.testScreen === 'test' && !state.isCompleted) {
        const saved = config.save();
        let message = saved ? 'Trở về danh sách bài thi? Bài làm được lưu để tiếp tục trên thiết bị này.' : 'Bài làm chưa lưu được. Nếu rời trang, bạn có thể mất câu trả lời. Vẫn muốn trở về?';
        if (state.endTime) message += '\nThời gian làm bài vẫn tiếp tục tính khi bạn rời trang.';
        if ([...document.querySelectorAll('audio')].some(audio => !audio.paused && !audio.ended)) message += '\nAudio đang phát sẽ dừng; lượt nghe đã bắt đầu vẫn được tính.';
        if (!confirm(message)) { event.preventDefault(); return; }
      } else if ((submitting || config.isSubmitting?.()) && !confirm('Kết quả đang gửi lên máy chủ. Bạn vẫn muốn rời trang?')) {
        event.preventDefault(); return;
      }
      stopAudio();
    });
    const form = document.getElementById('start-form');
    const input = document.getElementById('student-name');
    form.addEventListener('submit', event => {
      if (!input.value.trim()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        input.setCustomValidity('Vui lòng nhập họ và tên.');
        input.reportValidity();
      }
    }, true);
    input.addEventListener('input', () => input.setCustomValidity(''));
    document.getElementById('btn-restart-clear').addEventListener('click', event => {
      if (!confirm('Xóa bài đang làm và bắt đầu lại?')) {
        event.stopImmediatePropagation();
        return;
      }
      form.classList.remove('hidden');
    }, true);
    window.addEventListener('beforeunload', event => {
      if ((!storageOK && document.body.dataset.testScreen === 'test') || submitting || config.isSubmitting?.()) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    const review = document.getElementById('btn-toggle-review');
    if (review) {
      review.setAttribute('aria-controls', 'review-container');
      review.setAttribute('aria-expanded', 'false');
      review.addEventListener('click', () => review.setAttribute('aria-expanded', String(!document.getElementById('review-container').classList.contains('hidden'))));
    }
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'test-secondary result-download';
    download.textContent = 'Tải bản sao bài làm';
    download.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ test: document.title, ...config.getState() }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'pala-test-result.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    document.getElementById('result-screen').append(download);
  }

  function renderSubmission() {
    if (!config || config.customSubmission) return;
    let panel = document.getElementById('submission-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'submission-panel';
      panel.innerHTML = '<p role="status" aria-live="polite"></p><button type="button" class="test-secondary">Gửi lại kết quả</button>';
      document.getElementById('result-screen').append(panel);
      panel.querySelector('button').addEventListener('click', () => {
        if (!confirm('Gửi lại kết quả? Nếu máy chủ đã nhận lần trước nhưng mất kết nối khi xác nhận, kết quả có thể bị trùng.')) return;
        const state = config.getState();
        submitResult(state, state.submissionPayload, config.client, config.save);
      });
    }
    const state = config.getState();
    panel.querySelector('p').textContent = submitting ? 'Đang gửi kết quả lên máy chủ…' : state.submissionStatus === 'saved'
      ? 'Đã lưu kết quả lên máy chủ.' : 'Chưa xác nhận được kết quả trên máy chủ. Hãy giữ bản sao bài làm hoặc gửi lại.';
    panel.querySelector('button').hidden = state.submissionStatus === 'saved' || !state.submissionPayload;
    panel.querySelector('button').disabled = submitting;
    document.getElementById('btn-retake').disabled = submitting;
  }

  async function insertResult(client, payload) {
    if (!client) throw new Error('Không kết nối được dịch vụ lưu kết quả. Hãy tải lại trang để thử lại.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const request = client.from('test_results').insert([payload]);
      const result = await request.abortSignal(controller.signal);
      if (result.error) throw result.error;
    } finally { clearTimeout(timeout); }
  }

  async function submitResult(state, payload, client, save) {
    if (submitting || state.submissionStatus === 'saved' || !payload) return;
    submitting = true;
    state.submissionPayload = payload;
    state.submissionStatus = 'pending';
    save();
    renderSubmission();
    try {
      await insertResult(client, payload);
      state.submissionStatus = 'saved';
    } catch (error) {
      state.submissionStatus = 'failed';
      console.error('Không lưu được kết quả:', error);
    } finally {
      submitting = false;
      save();
      renderSubmission();
    }
  }

  return { escapeHtml, readState, saveState, clearState, setup, onScreen, stopAudio, insertResult, submitResult };
})();

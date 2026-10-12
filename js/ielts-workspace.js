/* One active part, independent passage/questions scrolling, and persistent review flags. */
window.IELTSWorkspace = (() => {
  let options;
  let active = 0;
  let currentQuestion;

  function mount(settings) {
    options = settings;
    const state = options.getState();
    state.flags ||= {};
    const screen = document.getElementById('test-screen');
    document.getElementById('exam-toolbar')?.remove();
    document.getElementById('exam-navigation')?.remove();
    const toolbar = document.createElement('div');
    toolbar.id = 'exam-toolbar';
    toolbar.innerHTML = '<div><span class="exam-eyebrow">IELTS practice</span><h2 id="active-part-title"></h2></div><div class="exam-tools"><label>Cỡ chữ <select id="exam-text-size"><option value="normal">A</option><option value="large">A+</option><option value="largest">A++</option></select></label><button type="button" id="review-question" class="test-secondary" aria-pressed="false">Đánh dấu xem lại</button></div>';
    screen.prepend(toolbar);
    toolbar.querySelector('select').value = state.textSize || 'normal';
    screen.dataset.textSize = toolbar.querySelector('select').value;
    toolbar.querySelector('select').addEventListener('change', event => {
      screen.dataset.textSize = state.textSize = event.target.value;
      options.save();
    });
    toolbar.querySelector('button').addEventListener('click', () => {
      if (currentQuestion === undefined) return;
      state.flags[currentQuestion] = !state.flags[currentQuestion];
      options.save();
      refresh();
    });

    const navigation = document.createElement('nav');
    navigation.id = 'exam-navigation';
    navigation.setAttribute('aria-label', 'Điều hướng bài thi');
    navigation.innerHTML = '<div id="exam-parts" role="tablist" aria-label="Các phần bài thi"></div><div class="exam-question-row"><button type="button" id="previous-part" class="test-secondary" aria-label="Phần trước">←</button><div id="exam-questions" aria-label="Câu hỏi"></div><button type="button" id="next-part" class="test-secondary" aria-label="Phần tiếp theo">→</button></div><p class="exam-legend"><span class="legend-answered"></span> Đã trả lời <span class="legend-flagged">⚑</span> Xem lại <span id="exam-part-progress" aria-live="polite"></span></p>';
    screen.append(navigation);
    options.parts.forEach((part, index) => {
      const panel = document.getElementById('questions-container').children[index];
      panel.classList.add('exam-part');
      panel.id = `exam-part-${index}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `exam-tab-${index}`);
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.id = `exam-tab-${index}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', panel.id);
      tab.textContent = part.title;
      tab.addEventListener('click', () => selectPart(index));
      tab.addEventListener('keydown', event => {
        let target;
        if (event.key === 'ArrowRight') target = (index + 1) % options.parts.length;
        if (event.key === 'ArrowLeft') target = (index + options.parts.length - 1) % options.parts.length;
        if (event.key === 'Home') target = 0;
        if (event.key === 'End') target = options.parts.length - 1;
        if (target !== undefined) {
          event.preventDefault();
          selectPart(target);
          document.getElementById(`exam-tab-${target}`).focus();
        }
      });
      navigation.querySelector('#exam-parts').append(tab);
      panel.querySelectorAll('[data-question]').forEach(card => {
        const question = card.dataset.question;
        card.querySelectorAll('input, textarea').forEach(input => {
          input.setAttribute(input.type === 'radio' ? 'aria-describedby' : 'aria-labelledby', `question-title-${question}`);
          input.addEventListener('focus', () => { currentQuestion = Number(question); refresh(); });
        });
        const writing = card.querySelector('textarea');
        if (writing) {
          const count = document.createElement('p');
          count.className = 'word-count';
          const updateCount = () => { count.textContent = `Số từ: ${writing.value.trim() ? writing.value.trim().split(/\s+/u).length : 0}`; };
          writing.after(count);
          writing.addEventListener('input', updateCount);
          updateCount();
        }
      });
    });
    navigation.querySelector('#previous-part').addEventListener('click', () => selectPart(active - 1));
    navigation.querySelector('#next-part').addEventListener('click', () => selectPart(active + 1));
    selectPart(Number.isInteger(state.activePart) ? state.activePart : 0, false);
  }

  function questions(index) { return options.parts[index].questionSets.flatMap(set => set.questions); }

  function selectPart(index, persist = true) {
    active = Math.max(0, Math.min(options.parts.length - 1, index));
    const state = options.getState();
    state.activePart = active;
    currentQuestion = questions(active)[0]?.number;
    document.querySelectorAll('.exam-part').forEach((panel, index) => { panel.hidden = index !== active; });
    document.querySelectorAll('#exam-parts button').forEach((tab, index) => {
      tab.setAttribute('aria-selected', String(index === active));
      tab.tabIndex = index === active ? 0 : -1;
    });
    document.getElementById('active-part-title').textContent = options.parts[active].title;
    const list = document.getElementById('exam-questions');
    list.replaceChildren();
    questions(active).forEach(question => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.questionNav = question.number;
      button.textContent = question.displayNumber ?? question.number;
      button.addEventListener('click', () => {
        currentQuestion = question.number;
        const card = document.getElementById(`question-${question.number}`);
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        card.querySelector('input, textarea')?.focus({ preventScroll: true });
        refresh();
      });
      list.append(button);
    });
    document.getElementById('previous-part').disabled = active === 0;
    document.getElementById('next-part').disabled = active === options.parts.length - 1;
    document.getElementById('highlight-btn').classList.add('hidden');
    if (persist) options.save();
    refresh();
  }

  function refresh() {
    if (!options) return;
    const state = options.getState();
    const answered = number => Boolean(String(state.answers[number] || '').trim());
    document.querySelectorAll('[data-question-nav]').forEach(button => {
      const number = Number(button.dataset.questionNav);
      const flagged = Boolean(state.flags[number]);
      button.classList.toggle('is-answered', answered(number));
      button.classList.toggle('is-flagged', flagged);
      button.setAttribute('aria-current', String(number === currentQuestion));
      button.setAttribute('aria-label', `Câu ${button.textContent}: ${answered(number) ? 'đã trả lời' : 'chưa trả lời'}${flagged ? ', đánh dấu xem lại' : ''}`);
    });
    const review = document.getElementById('review-question');
    review.setAttribute('aria-pressed', String(Boolean(state.flags[currentQuestion])));
    review.textContent = state.flags[currentQuestion] ? '⚑ Đã đánh dấu' : '⚑ Đánh dấu xem lại';
    const partQuestions = questions(active);
    document.getElementById('exam-part-progress').textContent = `${partQuestions.filter(q => answered(q.number)).length}/${partQuestions.length} câu trong phần này`;
  }

  function initResizers() {
    document.querySelectorAll('.resizer').forEach(resizer => {
      const container = resizer.parentElement;
      let dragging = false;
      const setWidth = value => {
        const width = Math.max(30, Math.min(70, value));
        container.style.setProperty('--passage-width', `${width}%`);
        resizer.setAttribute('aria-valuenow', String(Math.round(width)));
      };
      resizer.tabIndex = 0;
      resizer.setAttribute('role', 'separator');
      resizer.setAttribute('aria-label', 'Điều chỉnh độ rộng bài đọc');
      resizer.setAttribute('aria-orientation', 'vertical');
      resizer.setAttribute('aria-valuemin', '30');
      resizer.setAttribute('aria-valuemax', '70');
      setWidth(50);
      resizer.addEventListener('pointerdown', event => {
        event.preventDefault();
        dragging = true;
        resizer.setPointerCapture(event.pointerId);
        container.classList.add('is-resizing');
      });
      resizer.addEventListener('pointermove', event => {
        if (!dragging) return;
        const bounds = container.getBoundingClientRect();
        setWidth((event.clientX - bounds.left) / bounds.width * 100);
      });
      const finish = () => { dragging = false; container.classList.remove('is-resizing'); };
      resizer.addEventListener('pointerup', finish);
      resizer.addEventListener('pointercancel', finish);
      resizer.addEventListener('lostpointercapture', finish);
      resizer.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
        event.preventDefault();
        setWidth(event.key === 'Home' ? 50 : Number(resizer.getAttribute('aria-valuenow')) + (event.key === 'ArrowRight' ? 5 : -5));
      });
    });
  }

  return { mount, refresh, initResizers };
})();

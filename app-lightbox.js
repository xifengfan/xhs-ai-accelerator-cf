// ================================================
// app-lightbox.js
// 用途：方法论页图片灯箱（点击放大 + 键盘/触摸翻页）
// 设计：纯手写、零依赖、移动端友好
// 触发：methods.html 中所有 <img class="method-lightbox-img">
// ================================================

(function () {
  'use strict';

  // === 配置 ===
  const SELECTOR = '.method-lightbox-img, [data-lightbox-img]';
  const GROUP_ATTR = 'data-lightbox-group';

  // === 状态 ===
  let currentGroup = null;   // 当前组名
  let currentIndex = -1;     // 当前图在组里的位置
  let lightboxEl = null;     // 灯箱 DOM
  let lightboxImg = null;    // 灯箱里的 img
  let lightboxCounter = null; // "03 / 08" 计数器
  let lightboxCaption = null; // 图注
  let touchStartX = 0;       // 触摸起点
  let touchStartY = 0;       // 触摸起点 Y
  let lastFocus = null;      // 打开前的焦点

  // === 工具 ===
  function buildLightbox() {
    if (lightboxEl) return lightboxEl;

    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '图片预览');
    overlay.tabIndex = -1;

    overlay.innerHTML = [
      '<div class="lightbox-toolbar">',
      '  <div class="lightbox-counter"></div>',
      '  <button class="lightbox-close" aria-label="关闭（ESC）" type="button">×</button>',
      '</div>',
      '<button class="lightbox-prev" aria-label="上一张（←）" type="button">‹</button>',
      '<button class="lightbox-next" aria-label="下一张（→）" type="button">›</button>',
      '<figure class="lightbox-figure">',
      '  <img class="lightbox-img" alt="" />',
      '  <figcaption class="lightbox-caption"></figcaption>',
      '</figure>',
    ].join('\n');

    document.body.appendChild(overlay);
    lightboxEl = overlay;
    lightboxImg = overlay.querySelector('.lightbox-img');
    lightboxCounter = overlay.querySelector('.lightbox-counter');
    lightboxCaption = overlay.querySelector('.lightbox-caption');

    // 事件：× 关闭
    overlay.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
    // 事件：← 上一张
    overlay.querySelector('.lightbox-prev').addEventListener('click', (e) => { e.stopPropagation(); prevImage(); });
    // 事件：→ 下一张
    overlay.querySelector('.lightbox-next').addEventListener('click', (e) => { e.stopPropagation(); nextImage(); });
    // 事件：点击背景关闭（图片本身不触发）
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeLightbox();
    });
    // 事件：键盘
    document.addEventListener('keydown', onKeydown);
    // 事件：触摸滑动
    overlay.addEventListener('touchstart', onTouchStart, { passive: true });
    overlay.addEventListener('touchend', onTouchEnd, { passive: true });

    return overlay;
  }

  // === 当前组所有图（按 DOM 顺序）===
  function getGroupImages(group) {
    if (!group) {
      return Array.from(document.querySelectorAll(SELECTOR));
    }
    return Array.from(document.querySelectorAll('[' + GROUP_ATTR + '="' + group + '"]'));
  }

  // === 打开 ===
  function openLightbox(img, group, index) {
    if (!img) return;
    lastFocus = document.activeElement;
    buildLightbox();
    currentGroup = group || null;
    currentIndex = index;
    showCurrent();
    lightboxEl.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    // 焦点管理
    setTimeout(() => {
      lightboxEl.focus();
      // 预加载前后图
      preloadAdjacent();
    }, 50);
  }

  // === 关闭 ===
  function closeLightbox() {
    if (!lightboxEl || !lightboxEl.classList.contains('is-open')) return;
    lightboxEl.classList.remove('is-open');
    document.body.style.overflow = '';
    currentGroup = null;
    currentIndex = -1;
    // 恢复焦点
    if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    }
  }

  // === 显示当前图 ===
  function showCurrent() {
    const imgs = getGroupImages(currentGroup);
    if (!imgs.length) return;
    if (currentIndex < 0) currentIndex = 0;
    if (currentIndex >= imgs.length) currentIndex = imgs.length - 1;

    const img = imgs[currentIndex];
    const src = img.getAttribute('src') || img.src;
    const alt = img.getAttribute('alt') || '';

    lightboxImg.classList.remove('is-loaded');
    lightboxImg.src = src;
    lightboxImg.alt = alt;
    lightboxImg.onload = () => lightboxImg.classList.add('is-loaded');

    // 计数器
    if (imgs.length > 1) {
      lightboxCounter.textContent = String(currentIndex + 1).padStart(2, '0') + ' / ' + String(imgs.length).padStart(2, '0');
    } else {
      lightboxCounter.textContent = '';
    }

    // 图注：用 alt
    lightboxCaption.textContent = alt;

    // 翻页按钮显示控制
    const prevBtn = lightboxEl.querySelector('.lightbox-prev');
    const nextBtn = lightboxEl.querySelector('.lightbox-next');
    if (imgs.length <= 1) {
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'none';
    } else {
      prevBtn.style.display = '';
      nextBtn.style.display = '';
      // 循环翻页
      prevBtn.style.opacity = '1';
      nextBtn.style.opacity = '1';
    }
  }

  // === 翻页 ===
  function nextImage() {
    const imgs = getGroupImages(currentGroup);
    if (!imgs.length) return;
    currentIndex = (currentIndex + 1) % imgs.length;
    showCurrent();
  }
  function prevImage() {
    const imgs = getGroupImages(currentGroup);
    if (!imgs.length) return;
    currentIndex = (currentIndex - 1 + imgs.length) % imgs.length;
    showCurrent();
  }

  // === 预加载相邻图 ===
  function preloadAdjacent() {
    const imgs = getGroupImages(currentGroup);
    if (!imgs.length) return;
    [currentIndex + 1, currentIndex - 1].forEach(i => {
      const real = (i + imgs.length) % imgs.length;
      const src = imgs[real].getAttribute('src') || imgs[real].src;
      const pre = new Image();
      pre.src = src;
    });
  }

  // === 键盘 ===
  function onKeydown(e) {
    if (!lightboxEl || !lightboxEl.classList.contains('is-open')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); nextImage(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); prevImage(); }
    else if (e.key === 'Tab') {
      // 焦点循环
      e.preventDefault();
      const focusable = lightboxEl.querySelectorAll('button');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
      }
    }
  }

  // === 触摸滑动 ===
  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
  function onTouchEnd(e) {
    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    // 横向滑动幅度大于纵向、且超过 50px → 翻页
    if (absDx > 50 && absDx > absDy) {
      if (dx < 0) nextImage();
      else prevImage();
    }
    // 纵向下滑 > 100px → 关闭
    else if (dy > 100 && absDy > absDx) {
      closeLightbox();
    }
  }

  // === 全局点击代理 ===
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (target.tagName !== 'IMG') return;
    if (!target.matches(SELECTOR)) return;
    e.preventDefault();

    // 找组
    const group = target.getAttribute(GROUP_ATTR) || null;
    // 找组内位置
    const imgs = getGroupImages(group);
    const index = imgs.indexOf(target);
    openLightbox(target, group, index);
  });

  // 暴露给调试
  window.__lightbox = { open: openLightbox, close: closeLightbox, next: nextImage, prev: prevImage };
})();

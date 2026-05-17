(() => {
  const pages = Array.from(document.querySelectorAll(".page-sheet"));
  const book = document.querySelector(".book-flow");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!pages.length || !book) return;

  let currentIndex = 0;
  let isTurning = false;
  let wheelDelta = 0;
  let wheelTimer = 0;
  let touchStartX = 0;
  let touchStartY = 0;

  pages.forEach((page, index) => {
    page.dataset.pageIndex = String(index);
  });

  function updateCurrent(index) {
    currentIndex = Math.max(0, Math.min(index, pages.length - 1));
    pages.forEach((page, pageIndex) => {
      page.classList.toggle("is-current", pageIndex === currentIndex);
    });
  }

  function nearestPageIndex() {
    const bookRect = book.getBoundingClientRect();
    const viewportCenter = bookRect.left + bookRect.width / 2;
    let bestIndex = currentIndex;
    let bestDistance = Number.POSITIVE_INFINITY;

    pages.forEach((page, index) => {
      const rect = page.getBoundingClientRect();
      const pageCenter = rect.left + rect.width / 2;
      const distance = Math.abs(pageCenter - viewportCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  function clearTurnClasses() {
    pages.forEach((page) => {
      page.classList.remove("is-turning-forward", "is-turning-back", "is-receiving-page");
    });
  }

  function turnTo(index) {
    const targetIndex = Math.max(0, Math.min(index, pages.length - 1));
    if (targetIndex === currentIndex || isTurning) return;

    const fromPage = pages[currentIndex];
    const toPage = pages[targetIndex];
    const isForward = targetIndex > currentIndex;

    isTurning = true;
    clearTurnClasses();
    fromPage.classList.add(isForward ? "is-turning-forward" : "is-turning-back");
    toPage.classList.add("is-receiving-page");

    const move = () => {
      const left = toPage.offsetLeft - (book.clientWidth - toPage.clientWidth) / 2;
      book.scrollTo({
        left,
        behavior: reduceMotion ? "auto" : "smooth"
      });
      updateCurrent(targetIndex);
    };

    if (reduceMotion) {
      move();
      clearTurnClasses();
      isTurning = false;
      return;
    }

    window.setTimeout(move, 170);
    window.setTimeout(() => {
      clearTurnClasses();
      isTurning = false;
    }, 760);
  }

  function turnBy(delta) {
    updateCurrent(nearestPageIndex());
    turnTo(currentIndex + delta);
  }

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = document.querySelector(link.getAttribute("href"));
      const targetIndex = pages.indexOf(target);
      if (targetIndex === -1) return;
      event.preventDefault();
      updateCurrent(nearestPageIndex());
      turnTo(targetIndex);
    });
  });

  document.addEventListener("keydown", (event) => {
    const activeTag = document.activeElement?.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;

    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      turnBy(1);
    }
    if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      turnBy(-1);
    }
  });

  book.addEventListener("wheel", (event) => {
    if (isTurning) return;

    const activePage = pages[currentIndex];
    const canScrollDown = activePage.scrollTop + activePage.clientHeight < activePage.scrollHeight - 2;
    const canScrollUp = activePage.scrollTop > 2;

    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      if ((event.deltaY > 0 && canScrollDown) || (event.deltaY < 0 && canScrollUp)) {
        return;
      }
    }

    const primaryDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

    if (Math.abs(primaryDelta) < 8) return;

    event.preventDefault();
    wheelDelta += primaryDelta;
    window.clearTimeout(wheelTimer);

    if (Math.abs(wheelDelta) > 70) {
      turnBy(wheelDelta > 0 ? 1 : -1);
      wheelDelta = 0;
      return;
    }

    wheelTimer = window.setTimeout(() => {
      wheelDelta = 0;
    }, 140);
  }, { passive: false });

  book.addEventListener("touchstart", (event) => {
    const touch = event.changedTouches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }, { passive: true });

  book.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    if (distance < 54) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      turnBy(dx < 0 ? 1 : -1);
    } else {
      turnBy(dy < 0 ? 1 : -1);
    }
  }, { passive: true });

  let scrollTicking = false;
  book.addEventListener("scroll", () => {
    if (scrollTicking || isTurning) return;
    scrollTicking = true;
    window.requestAnimationFrame(() => {
      updateCurrent(nearestPageIndex());
      scrollTicking = false;
    });
  }, { passive: true });

  updateCurrent(nearestPageIndex());
})();

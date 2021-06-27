// A css class that's set on a post that has been marked as read
const READ_INDICATOR_CLASS = "hackernews-extension__comment-has-been-read";

// Flag that is stored in localstorage to indicate comment has been read.
const IS_READ_FLAG = 'is-read';

const HOLDOWN_TIMER_IN_SECONDS = 7;

function main() {
  const articleId = getArticleId();
  if (articleId) {
    const holddownTimer = new HolddownTimer();
    const elementObserver = new ElementObserver();
    const commentRepository = new HNCommentsRepository(articleId);

    holddownTimer.onHolddownExpired(element => {
      const commentId = element.id;
      commentRepository.markCommentAsRead(commentId);
      elementObserver.stopObservingElement(element);
    })

    elementObserver.onElementInViewport(element => {
      const commentId = element.id;
      if (commentRepository.hasBeenRead(commentId)) {
        element.classList.add(READ_INDICATOR_CLASS);
        elementObserver.stopObservingElement(element);
      } else {
        holddownTimer.holddown(element, HOLDOWN_TIMER_IN_SECONDS);
      }
    });
    elementObserver.onElementLeftViewport(element => holddownTimer.remove(element));

    elementObserver.startObservingAllElements('.comtr');

    function reset() {
      holddownTimer.clear();
      elementObserver.stopObservingAllElements();
      elementObserver.startObservingAllElements('.comtr');
    }

    installToolbarLinks(
      () => {
        // Marking all comments as read
        commentRepository.markAllCommentsAsRead();
        reset();
      },
      () => {
        // Marking all comments as not read
        commentRepository.markAllCommentsAsNotRead();
        reset();
      }
    );
  }
}

class HNCommentsRepository {
  constructor(articleId) {
    this._articleId = articleId;
  }

  /**
   * Marks the comment as read.
   * 
   * @param {String} commentId Comment id.
   */
  markCommentAsRead(commentId) {
    localStorage.setItem(this._localStorageCommentKey(commentId), IS_READ_FLAG);
  }

  /**
   * True if all comments have been read.
   * 
   * @returns True if all comments have been read.
   */
  haveAllCommentsBeenRead() {
    return localStorage.getItem(this._localStorageArticleKey()) === IS_READ_FLAG;
  }

  /**
   * True if comment has been read.
   * 
   * @param {String} commentId Comment id.
   * @returns True if comment has been already read.
   */
  hasBeenRead(commentId) {
    if (this.haveAllCommentsBeenRead()) {
      return true;
    }
    return localStorage.getItem(this._localStorageCommentKey(commentId)) === IS_READ_FLAG;
  }

  /**
   * Marks all comments in the article as read.
   */
  markAllCommentsAsRead() {
    this._removeAllReadCommentsForCurrentArticle();
    localStorage.setItem(this._localStorageArticleKey(), IS_READ_FLAG);
  }

  /**
   * Marks all comments as not read.
   */
  markAllCommentsAsNotRead() {
    this._removeAllReadCommentsForCurrentArticle();
    localStorage.removeItem(this._localStorageArticleKey());

    const elementCollection = document.getElementsByClassName(READ_INDICATOR_CLASS);
    for (let element of elementCollection) {
      element.classList.remove(READ_INDICATOR_CLASS);
    }
  }

  _removeAllReadCommentsForCurrentArticle() {
    for (var key in localStorage) {
      if (this._matchesCurrentArticle(key)) {
        localStorage.removeItem(key);
      }
    }
  }

  _matchesCurrentArticle(key) {
    return key.startsWith(this._articleId + '-');
  }

  _localStorageCommentKey(commentId) {
    return this._articleId + '-' + commentId;
  }

  _localStorageArticleKey() {
    return this._articleId + '-*';
  }
}

class ElementObserver {
  constructor() {
    this._onElementInViewportCallback = null;
    this._onElementLeftViewportCallback = null;

    const options = {
      root: null,
      rootMargin: '0px',
      threshold: 0.2
    }

    this._onIntersectionObserverCallback = this._onIntersectionObserverCallback.bind(this);
    this._observer = new IntersectionObserver(this._onIntersectionObserverCallback, options);
  }

  /**
   * Starts observing all elements given their selector. If element gets in the
   * view port a onElementInViewportCallback will be called. If element leaves
   * the viewport then onElementLeftViewportCallback will ba called
   * 
   * @param {String} selector 
   */
  startObservingAllElements(selector) {
    document.querySelectorAll(selector).forEach(element => this._observer.observe(element));
  }

  /**
   * Stops observing all elements.
   */
  stopObservingAllElements() {
    this._observer.disconnect();
  }

  /**
   * Stops observing this element. No callbacks will be called for this element
   * anymore.
   * 
   * @param {HTMLElement} element Element.
   */
  stopObservingElement(element) {
    this._observer.unobserve(element);
  }

  /**
   * Registers a callback which is triggered when element enters viewport.
   * 
   * @param {Function} onElementInViewportCallback Callback.
   */
  onElementInViewport(onElementInViewportCallback) {
    this._onElementInViewportCallback = onElementInViewportCallback;
  }

  /**
   * Registers a callback which is triggered when element leaves viewport.
   * 
   * @param {Function} onElementLeftViewportCallback Callback
   */
  onElementLeftViewport(onElementLeftViewportCallback) {
    this._onElementLeftViewportCallback = onElementLeftViewportCallback;
  }

  _onIntersectionObserverCallback(entries) {
    entries.forEach(entry => {
      const element = entry.target;
      const elementIsInViewPort = entry.isIntersecting;

      if (elementIsInViewPort) {
        this._onElementInViewportCallback(element);
      } else {
        this._onElementLeftViewportCallback(element);
      }
    });
  }
}

/**
 * Holddown timer watches over collection of elements for some period of time
 * and raises an onHolddownExpiredCallback once that time has been expired.
 */
class HolddownTimer {
  constructor() {
    this._interval = null;
    this._holddownMap = new Map();
    this._onHolddownExpiredCallback = null;
    this._onTick = this._onTick.bind(this);
  }

  /**
   * Clears all elements from current holdown.
   */
  clear() {
    this._holddownMap.clear();
    this._stopHolddownInterval();
  }

  /**
   * Registers a callback that is invoked once holddown timer expires for some
   * element.
   * 
   * @param {Function} onHolddownExpiredCallback Callback.
   */
  onHolddownExpired(onHolddownExpiredCallback) {
    this._onHolddownExpiredCallback = onHolddownExpiredCallback;
  }

  /**
   * Starts the holddown timer for specific element, for specific number of 
   * seconds. Once this time is expired, a onHolddownExpiredCallback will be
   * called with the approprirat element.
   * 
   * @param {HTMLElement} element Html element.
   * @param {Number} holddownTimeInSeconds Time in seconds to wait. Once this 
   * time reaches 0, onHolddownExpiredCallback will triggered.
   */
  holddown(element, holddownTimeInSeconds) {
    this._holddownMap.set(element, { holddownTimeInSeconds });
    this._startHolddownInterval();
  }

  /**
   * Removes the element from holddown.
   * 
   * @param {HTMLElement} element Html element
   */
  remove(element) {
    this._holddownMap.delete(element);
    if (this._holddownMap.size === 0) {
      this._stopHolddownInterval();
    }
  }

  _startHolddownInterval() {
    if (this._interval === null) {
      this._interval = setInterval(this._onTick, 1000);
    }
  }

  _stopHolddownInterval() {
    if (this._interval !== null) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  _onElementHolddownTimerExpired(element) {
    this.remove(element);
    this._onHolddownExpiredCallback(element);
  }

  _onTick() {
    const mapIterator = this._holddownMap.keys();
    let mapIteratorEntry = mapIterator.next();
    while (!mapIteratorEntry.done) {
      const element = mapIteratorEntry.value;
      const holddownEntry = this._holddownMap.get(element);

      if (holddownEntry.holddownTimeInSeconds <= 0) {
        this._onElementHolddownTimerExpired(element);
      } else {
        holddownEntry.holddownTimeInSeconds--;
      }
      mapIteratorEntry = mapIterator.next();
    }
  }
}

/**
 * Returns an article id. Article id is an id query param in URL ie
 * https://news.ycombinator.com/item?id=27650477, article id is 27650477.
 * 
 * @returns Article id.
 */
function getArticleId() {
  const url = new URL(window.location.toString())
  return url.searchParams.get("id");
}

/**
 * Installs mark-all-as-read and mark-all-as-unread links in toolbar.
 * 
 * Appropriate callbacks are called once specific links are clicked.
 * 
 * @param {Function} onMarkAllAsRead Callback
 * @param {Function} onMarkAllAsUnread Callback
 */
function installToolbarLinks(onMarkAllAsRead, onMarkAllAsUnread) {
  const toolbar = document.querySelector('.fatitem .subtext');

  const markAllAsReadElement = document.createElement("a");
  markAllAsReadElement.href = '#';
  markAllAsReadElement.text = 'mark all as read';
  markAllAsReadElement.onclick = (ev) => {
    onMarkAllAsRead();
    ev.preventDefault();
  };

  const markAllAsUnreadElement = document.createElement("a");
  markAllAsUnreadElement.href = '#';
  markAllAsUnreadElement.text = 'mark all as not read';
  markAllAsUnreadElement.onclick = (ev) => {
    onMarkAllAsUnread();
    ev.preventDefault();
  };

  const separator = document.createTextNode(' | ');

  const toolbarLinks = toolbar.querySelectorAll('a');
  if (toolbarLinks.length > 0) {
    const lastToolbarLink = toolbarLinks.item(toolbarLinks.length - 1);

    lastToolbarLink.previousSibling.after(markAllAsReadElement);
    markAllAsReadElement.after(separator);
    separator.after(markAllAsUnreadElement);
    markAllAsUnreadElement.after(separator.cloneNode());
  }
}

main();
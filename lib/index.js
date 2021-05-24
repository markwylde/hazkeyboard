/**
 * on-screen-keyboard-detector: oskd-ios.js
 *
 * Created by Matthias Seemann on 28.04.2020.
 */

const { at, debounce, delay, empty, filter, join, map, merge, mergeArray, multicast, now, runEffects, scan, skipAfter, skipRepeats, snapshot, switchLatest, startWith, tap, until } = require('@most/core');
const { newDefaultScheduler } = require('@most/scheduler');
const { change, domEvent, focusin, focusout, resize } = require('@most/dom-event');
const { createAdapter } = require('@most/adapter');

const { always, assoc, applyTo, compose, curry, difference, equals, pipe, isEmpty, identical, keys, propEq } = require('ramda');
const ios = require('./ios.js');

const userAgent = navigator.userAgent;
const isTouchable = 'ontouchend' in document;
const isIPad = /\b(\w*Macintosh\w*)\b/.test(userAgent) && isTouchable;
const isIPhone = /\b(\w*iPhone\w*)\b/.test(userAgent) &&
            /\b(\w*Mobile\w*)\b/.test(userAgent) &&
            isTouchable;
const isIOS = isIPad || isIPhone;

const getScreenOrientationType = () =>
  screen.orientation.type.startsWith('portrait') ? 'portrait' : 'landscape';

const rejectCapture = curry(compose(join, snapshot((valveValue, event) => valveValue ? empty() : now(event))));

const isAnyElementActive = () => document.activeElement && (document.activeElement !== document.body);

function isSupported () {
  if (isIOS) {
    return ios.isSupported();
  }

  return isTouchable;
}

function initWithCallback (userCallback) {
  if (isIOS) {
    return ios.subscribe(userCallback);
  }

  const
    INPUT_ELEMENT_FOCUS_JUMP_DELAY = 700;
  const SCREEN_ORIENTATION_TO_WINDOW_RESIZE_DELAY = 700;
  const RESIZE_QUIET_PERIOD = 500;
  const LAYOUT_RESIZE_TO_LAYOUT_HEIGHT_FIX_DELAY =
			Math.max(INPUT_ELEMENT_FOCUS_JUMP_DELAY, SCREEN_ORIENTATION_TO_WINDOW_RESIZE_DELAY) - RESIZE_QUIET_PERIOD + 200;

  const [induceUnsubscribe, userUnsubscription] = createAdapter();
  const scheduler = newDefaultScheduler();

  // assumes initially hidden OSK
  const initialLayoutHeight = window.innerHeight;
  // assumes initially hidden OSK
  const approximateBrowserToolbarHeight = screen.availHeight - window.innerHeight;

  const focus =
			merge(focusin(document.documentElement), focusout(document.documentElement));

  const documentVisibility =
			applyTo(domEvent('visibilitychange', document))(pipe(
			  map(() => document.visibilityState),
			  startWith(document.visibilityState)
			));

  const isUnfocused =
			applyTo(focus)(pipe(
			  map(evt =>
			    evt.type === 'focusin' ? now(false) : at(INPUT_ELEMENT_FOCUS_JUMP_DELAY, true)
			  ),
			  switchLatest,
			  startWith(!isAnyElementActive()),
			  skipRepeats,
			  multicast
			));

  const layoutHeightOnOSKFreeOrientationChange =
			applyTo(change(screen.orientation))(pipe(
			  // The 'change' event hits very early BEFORE window.innerHeight is updated (e.g. on "resize")
			  snapshot(
			    unfocused => unfocused || (window.innerHeight === initialLayoutHeight),
			    isUnfocused
			  ),
			  debounce(SCREEN_ORIENTATION_TO_WINDOW_RESIZE_DELAY),
			  map(isOSKFree => ({
			    screenOrientation: getScreenOrientationType(),
			    height: isOSKFree ? window.innerHeight : screen.availHeight - approximateBrowserToolbarHeight
			  }))
			));

  const layoutHeightOnUnfocus =
			applyTo(isUnfocused)(pipe(
			  filter(identical(true)),
			  map(() => ({ screenOrientation: getScreenOrientationType(), height: window.innerHeight }))
			));

  // Difficulties: The exact layout height in the perpendicular orientation is only to determine on orientation change,
  // Orientation change can happen:
  // - entirely unfocused,
  // - focused but w/o OSK, or
  // - with OSK.
  // Thus on arriving in the new orientation, until complete unfocus, it is uncertain what the current window.innerHeight value means

  // Solution?: Assume initially hidden OSK (even if any input has the "autofocus" attribute),
  // and initialize other dimension with screen.availWidth
  // so there can always be made a decision on the keyboard.
  const layoutHeights =
			// Ignores source streams while documentVisibility is 'hidden'
			// sadly visibilitychange comes 1 sec after focusout!
			applyTo(mergeArray([layoutHeightOnUnfocus, layoutHeightOnOSKFreeOrientationChange]))(pipe(
			  delay(1000),
			  rejectCapture(map(equals('hidden'), documentVisibility)),
			  scan(
			    (accHeights, { screenOrientation, height }) =>
			      assoc(screenOrientation, height, accHeights),
			    {
			      [getScreenOrientationType()]: window.innerHeight
			    }
			  ),
			  skipAfter(compose(isEmpty, difference(['portrait', 'landscape']), keys))
			));

  const layoutHeightOnVerticalResize =
			applyTo(resize(window))(pipe(
			  debounce(RESIZE_QUIET_PERIOD),
			  map(evt => ({ width: evt.target.innerWidth, height: evt.target.innerHeight })),
			  scan(
			    (prev, size) =>
			      ({
			        ...size,
			        isJustHeightResize: prev.width === size.width,
			        dH: size.height - prev.height
			      }),
			    {
			      width: window.innerWidth,
			      height: window.innerHeight,
			      isJustHeightResize: false,
			      dH: 0
			    }
			  ),
			  filter(propEq('isJustHeightResize', true))
			));

  const osk =
			applyTo(layoutHeightOnVerticalResize)(pipe(
			  delay(LAYOUT_RESIZE_TO_LAYOUT_HEIGHT_FIX_DELAY),
			  snapshot(
			    (layoutHeightByOrientation, { height, dH }) => {
			      const
			        nonOSKLayoutHeight = layoutHeightByOrientation[getScreenOrientationType()];

			      if (!nonOSKLayoutHeight) {
			        return (dH > 0.1 * screen.availHeight) ? now('hidden')
			          : (dH < -0.1 * screen.availHeight) ? now('visible')
			              : empty();
			      }

			      return (height < 0.9 * nonOSKLayoutHeight) && (dH < 0) ? now('visible')
			        : (height === nonOSKLayoutHeight) && (dH > 0) ? now('hidden')
			            : empty();
			    },
			    layoutHeights
			  ),
			  join,
			  merge(applyTo(isUnfocused)(pipe(
			    filter(identical(true)),
			    map(always('hidden'))
			  ))),
			  until(userUnsubscription),
			  skipRepeats
			));

  runEffects(tap(userCallback, osk), scheduler);

  return induceUnsubscribe;
}

module.exports = {
  subscribe: initWithCallback,
  isSupported
};

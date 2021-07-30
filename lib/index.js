const EventEmitter = require('events');

const eventEmitter = new EventEmitter();

document.addEventListener('focusin', (event) => {
  if (event.target.tagName === 'INPUT' && event.target.type === 'text') {
		eventEmitter.emit('change');
    eventEmitter.emit('show');
		eventEmitter.visible = true;
		eventEmitter.hidden = false;
  }
})

document.addEventListener('focusout', (event) => {
  if (event.target.tagName === 'INPUT' && event.target.type === 'text') {
		eventEmitter.emit('change');
    eventEmitter.emit('hide');
		eventEmitter.visible = false;
		eventEmitter.hidden = true;
  }
})

module.exports = eventEmitter;

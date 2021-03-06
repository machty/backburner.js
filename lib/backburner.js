import DeferredActionQueues from "backburner/deferred_action_queues";

var slice = [].slice,
    pop = [].pop,
    debouncees = [],
    timers = [],
    autorun, laterTimer, laterTimerExpiresAt;

function Backburner(queueNames, options) {
  this.queueNames = queueNames;
  this.options = options || {};
}

Backburner.prototype = {
  queueNames: null,
  options: null,
  currentInstance: null,
  previousInstance: null,

  begin: function() {
    if (this.currentInstance) {
      this.previousInstance = this.currentInstance;
    }
    this.currentInstance = new DeferredActionQueues(this.queueNames, this.options);
  },

  end: function() {
    try {
      this.currentInstance.flush();
    } finally {
      this.currentInstance = null;
      if (this.previousInstance) {
        this.currentInstance = this.previousInstance;
        this.previousInstance = null;
      }
    }
  },

  run: function(target, method /*, args */) {
    var ret;
    this.begin();

    if (!method) {
      method = target;
      target = null;
    }

    if (typeof method === 'string') {
      method = target[method];
    }

    try {
      if (arguments.length > 2) {
        ret = method.apply(target, slice.call(arguments, 2));
      } else {
        ret = method.call(target);
      }
    } finally {
      this.end();
    }
    return ret;
  },

  defer: function(queueName, target, method /* , args */) {
    if (!method) {
      method = target;
      target = null;
    }

    if (typeof method === 'string') {
      method = target[method];
    }

    var stack = new Error().stack,
        args = arguments.length > 3 ? slice.call(arguments, 3) : undefined;
    if (!this.currentInstance) { createAutorun(this); }
    return this.currentInstance.schedule(queueName, target, method, args, false, stack);
  },

  deferOnce: function(queueName, target, method /* , args */) {
    if (!method) {
      method = target;
      target = null;
    }

    if (typeof method === 'string') {
      method = target[method];
    }

    var stack = new Error().stack,
        args = arguments.length > 3 ? slice.call(arguments, 3) : undefined;
    if (!this.currentInstance) { createAutorun(this); }
    return this.currentInstance.schedule(queueName, target, method, args, true, stack);
  },

  setTimeout: function() {
    var self = this,
        wait = pop.call(arguments),
        target = arguments[0],
        method = arguments[1],
        executeAt = (+new Date()) + wait;

    if (!method) {
      method = target;
      target = null;
    }

    if (typeof method === 'string') {
      method = target[method];
    }

    var fn, args;
    if (arguments.length > 2) {
      args = slice.call(arguments, 2);

      fn = function() {
        method.apply(target, args);
      };
    } else {
      fn = function() {
        method.call(target);
      };
    }

    // find position to insert - TODO: binary search
    var i, l;
    for (i = 0, l = timers.length; i < l; i += 2) {
      if (executeAt < timers[i]) { break; }
    }

    timers.splice(i, 0, executeAt, fn);

    if (laterTimer && laterTimerExpiresAt < executeAt) { return fn; }

    if (laterTimer) {
      clearTimeout(laterTimer);
      laterTimer = null;
    }
    laterTimer = setTimeout(function() {
      executeTimers(self);
      laterTimer = null;
      laterTimerExpiresAt = null;
    }, wait);
    laterTimerExpiresAt = executeAt;

    return fn;
  },

  debounce: function(target, method /* , args, wait */) {
    var self = this,
        args = arguments,
        wait = pop.call(args),
        debouncee;

    for (var i = 0, l = debouncees.length; i < l; i++) {
      debouncee = debouncees[i];
      if (debouncee[0] === target && debouncee[1] === method) { return; } // do nothing
    }

    var timer = setTimeout(function() {
      self.run.apply(self, args);

      // remove debouncee
      var index = -1;
      for (var i = 0, l = debouncees.length; i < l; i++) {
        debouncee = debouncees[i];
        if (debouncee[0] === target && debouncee[1] === method) {
          index = i;
          break;
        }
      }

      if (index > -1) { debouncees.splice(index, 1); }
    }, wait);

    debouncees.push([target, method, timer]);
  },

  cancelTimers: function() {
    for (var i = 0, l = debouncees.length; i < l; i++) {
      clearTimeout(debouncees[i][2]);
    }
    debouncees = [];

    if (laterTimer) {
      clearTimeout(laterTimer);
      laterTimer = null;
    }
    timers = [];

    if (autorun) { clearTimeout(autorun); }
  },

  hasTimers: function() {
    return !!timers.length && !autorun;
  },

  cancel: function(timer) {
    if (typeof timer === 'object' && timer.queue && timer.method) { // we're cancelling a deferOnce
      return timer.queue.cancel(timer);
    } else if (typeof timer === 'function') { // we're cancelling a setTimeout
      for (var i = 0, l = timers.length; i < l; i += 2) {
        if (timers[i + 1] === timer) {
          timers.splice(i, 2); // remove the two elements
          return true;
        }
      }
    }
  }
};

Backburner.prototype.schedule = Backburner.prototype.defer;
Backburner.prototype.scheduleOnce = Backburner.prototype.deferOnce;
Backburner.prototype.later = Backburner.prototype.setTimeout;

function createAutorun(backburner) {
  backburner.begin();
  autorun = setTimeout(function() {
    backburner.end();
  });
}

function executeTimers(self) {
  var now = +new Date(),
      time, fns, i, l;

  self.run(function() {
    // TODO: binary search
    for (i = 0, l = timers.length; i < l; i += 2) {
      time = timers[i];
      if (time > now) { break; }
    }

    fns = timers.splice(0, i);

    for (i = 1, l = fns.length; i < l; i += 2) {
      self.schedule(self.queueNames[0], null, fns[i]); // TODO: make default queue configurable
    }
  });

  if (timers.length) {
    laterTimer = setTimeout(function() {
      executeTimers(self);
    }, timers[0] - now);
    laterTimerExpiresAt = timers[0];
  }
}

export Backburner;
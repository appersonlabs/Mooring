'use strict';
var _ = require('lodash');
var async = require('async');

/*
based on code from Isaac Schlueter's blog post and borroed from the grappling-hook keystone project:
http://blog.izs.me/post/59142742143/designing-apis-for-asynchrony
*/
function dezalgofy(fn, done) {
    var isSync = true;
    fn(safeDone); //eslint-disable-line no-use-before-define
    isSync = false;
    function safeDone() {
        var args = _.toArray(arguments);
        if (isSync) {
            process.nextTick(function() {
                done.apply(null, args);
            });
        } else {
            done.apply(null, args);
        }
    }
}

// An augmented version of the iteration method from Keystone's grappling-hook library
function iterateMiddleware(middleware, args, immutable, done) {
    done = done || /* istanbul ignore next: untestable */ function(err) {
        if (err) {
            throw err;
        }
    };

    async.eachSeries(middleware, function(middleware, next) {
        var callback = middleware.fn;

        if (middleware.isAsync) {
            middleware.fn.apply({}, args.concat(function() {
                args = immutable ? _.clone(args, true) : args;
                args = _.merge(args, _.toArray(arguments));
                next();
            }));
        } else {
            //synced
            var err;
            try {
                middleware.fn.apply({}, immutable ? _.clone(args, true) : args);
            } catch (e) {
                /* istanbul ignore next: untestable */ err = e;
            }

            //synced
            next(err);
        }

    }, function() {
        done.apply({}, args);
    });
}

function Mooring() {
    this._pres = {};
    this._posts = {};
}

Mooring.prototype.callHook = function(name, args, immutable, fn) {
    var _this = this;
    var methodCallback = _.isFunction(_.last(args)) ? args.pop() : undefined;
    args = immutable ? _.clone(args, true) : args;

    dezalgofy(function(safeDone) {
        async.waterfall([
            // call befores
            function (next) {
                // beforeArgs is used to ensure that callbacks are passed to JUST the before hook
                var beforeArgs = methodCallback ? _.clone(args).concat(methodCallback) : args;
                iterateMiddleware(_this._pres[name] || [], beforeArgs, immutable, function() {
                    var args = _.toArray(arguments);

                    // Override the callback so we continue and the CB does not short-circut the next step
                    if (_.isFunction(_.last(args))) {
                        args.pop();
                    }
                    next.apply({}, [null].concat(args));
                });
            },
            // call method
            function () {
                var args = _.toArray(arguments);
                var next = args.pop(); // the waterfall next method

                if(methodCallback) {
                    fn.apply({}, args.concat(function() {
                        var results = _.toArray(arguments);

                        next.apply({}, [null].concat(results));
                    }));
                } else {
                    var results = fn.apply({}, args);
                    next.apply({}, [null].concat(results));
                }
            },
            // call afters
            function () {
                var results = _.toArray(arguments);
                var next = results.pop();

                iterateMiddleware(_this._posts[name] || [], results, immutable, function() {
                    var afterResults = _.toArray(arguments);

                    next.apply({}, [null].concat(afterResults));
                });
            },
        ], function() {
            // call done
            var results = _.toArray(arguments);
            var err = results.shift();

            safeDone.apply({}, results);
        });
    }, methodCallback || function() {});

};

Mooring.prototype.createHook = function(name, fn) {
    var _this = this;
    return function() {
        var args = Array.prototype.slice.call(arguments);
        _this.callHook(name, args, true, fn);
    };
};


Mooring.prototype.createMutableHook = function(name, fn) {
    var _this = this;
    return function() {
        var args = Array.prototype.slice.call(arguments);
        _this.callHook(name, args, false, fn);
    };
};

Mooring.prototype.before = function(name, isAsync, fn) {
    if (typeof arguments[1] !== 'boolean') {
        fn = isAsync;
        isAsync = true;
    }

    this._pres[name] = this._pres[name] || [];
    var pres = this._pres[name];

    pres.push({ fn: fn, isAsync: isAsync });

    return this;
};

Mooring.prototype.after = function(name, isAsync, fn) {
    if (typeof arguments[1] !== 'boolean') {
        fn = isAsync;
        isAsync = true;
    }

    this._posts[name] = this._posts[name] || [];
    var posts = this._posts[name];

    posts.push({ fn: fn, isAsync: isAsync });
    return this;
};

module.exports = Mooring;

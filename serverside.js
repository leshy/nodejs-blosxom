// Generated by CoffeeScript 1.4.0
(function() {
  var Backbone, Wiki, async, collections, converter, crypto, decorate, decorators, ejslocals, env, express, fs, helpers, hound, http, init, initCollections, initDb, initExpress, initLogger, initRoutes, initRss, initWiki, makeLogDecorator, mongodb, pagedown, path, rss, settings, wraplog, _,
    __slice = [].slice;

  path = require('path');

  fs = require('fs');

  crypto = require('crypto');

  async = require('async');

  _ = require('underscore');

  Backbone = require('backbone4000');

  mongodb = require('mongodb');

  http = require('http');

  express = require('express');

  ejslocals = require('ejs-locals');

  collections = require('collections/serverside');

  helpers = require('helpers');

  decorators = require('decorators');

  decorate = decorators.decorate;

  hound = require('hound');

  rss = require('rss');

  pagedown = require('pagedown');

  converter = new pagedown.Converter();

  env = {};

  settings = {
    postsfolder: "posts"
  };

  ejslocals.ejs.filters.prettyDate = function(obj) {
    return helpers.prettyDate(obj);
  };

  initLogger = function(env, callback) {
    env.log = function() {
      var data, json, taglist, tags, text;
      text = arguments[0], data = arguments[1], taglist = 3 <= arguments.length ? __slice.call(arguments, 2) : [];
      tags = {};
      _.map(taglist, function(tag) {
        return tags[tag] = true;
      });
      if (tags.error) {
        text = text.red;
      }
      if (tags.error && _.keys(data).length) {
        json = " " + JSON.stringify(tags.error);
      } else {
        json = "";
      }
      return console.log(String(new Date()).yellow + " " + _.keys(tags).join(', ').green + " " + text + json);
    };
    env.logres = function(name, callback) {
      return function(err, data) {
        if (err) {
          env.log(name + ': ' + err, {
            error: err
          }, 'init', 'fail');
        } else {
          env.log(name + "...", {}, 'init', 'ok');
        }
        return callback(err, data);
      };
    };
    env.log('logger initialized', {}, 'init', 'info');
    return callback();
  };

  initDb = function(callback) {
    env.db = new mongodb.Db('blog', new mongodb.Server('localhost', 27017), {
      safe: true
    });
    return env.db.open(callback);
  };

  initCollections = function(callback) {
    env.blog = new collections.MongoCollection({
      db: env.db,
      collection: 'blog'
    });
    env.post = env.blog.defineModel('post', {
      output: function(ignoretags) {
        return {
          id: this.attributes.id,
          created: this.attributes.created,
          modified: this.attributes.modified,
          tags: _.without.apply(this, [_.keys(this.attributes.tags)].concat(ignoretags)),
          title: this.attributes.title,
          link: this.attributes.file,
          body: converter.makeHtml(this.attributes.body)
        };
      }
    });
    return callback();
  };

  initExpress = function(callback) {
    var app;
    env.app = app = express();
    app.configure(function() {
      app.engine('ejs', ejslocals.render);
      app.set('view engine', 'ejs');
      app.set('views', __dirname + '/views');
      app.use(express.favicon());
      app.use(express.logger('dev'));
      app.use(express.bodyParser());
      app.use(express.methodOverride());
      app.use(app.router);
      app.use(express["static"](__dirname + '/static'));
      return app.use(function(err, req, res, next) {
        env.log('web request error', {
          stack: err.stack
        }, 'error', 'http');
        return res.send(500, 'BOOOM!');
      });
    });
    env.server = http.createServer(env.app);
    env.server.listen(3333);
    env.log('http server listening', {}, 'info', 'init', 'http');
    return callback(void 0, true);
  };

  makeLogDecorator = function(name) {
    return function() {
      var args, callback, f;
      f = arguments[0], callback = arguments[1], args = 3 <= arguments.length ? __slice.call(arguments, 2) : [];
      return f(function(err, data) {
        if (!err) {
          env.log(name + ' ready', {}, 'info', 'init', 'done', name);
        } else {
          env.log(name + ' failed!', {}, 'info', 'init', 'error', name);
        }
        return callback(err, data);
      });
    };
  };

  wraplog = function(name, f) {
    return decorators.decorate(makeLogDecorator(name), f);
  };

  Wiki = Backbone.Model.extend4000({
    initialize: function() {
      var _this = this;
      return this.when('dir', function(dir) {
        _this.watchDir(dir);
        return _this.crawlDir(dir, function(file) {
          return _this.pingFile(file);
        });
      });
    },
    crawlDir: function(dir, callback) {
      var _this = this;
      return fs.readdir(dir, function(err, files) {
        if (err) {
          return;
        }
        return _.map(files, function(file) {
          var stat;
          file = path.normalize(dir + "/" + file);
          stat = fs.statSync(file);
          if (stat.isDirectory()) {
            _this.crawlDir(file, callback);
          }
          if (stat.isFile()) {
            return helpers.cbc(callback, file);
          }
        });
      });
    },
    watchDir: function(dir) {
      var watcher,
        _this = this;
      watcher = hound.watch(dir);
      watcher.on("create", function(f, stat) {
        if (stat.isFile()) {
          env.log('created file ' + f, {
            file: f
          }, 'info', 'fs', 'file', 'create');
          return _this.fileChanged(f);
        } else {
          return env.log('created dir ' + f, {
            file: f
          }, 'info', 'fs', 'dir', 'create');
        }
      });
      watcher.on("change", function(f, stat) {
        env.log('file changed ' + f, {
          file: f
        }, 'info', 'fs', 'file', 'change');
        return setTimeout(_this.fileChanged(f), 500);
      });
      return watcher.on("delete", function(f, stat) {
        env.log('deleted file ' + f, {
          file: f
        }, 'info', 'fs', 'file', 'delete');
        return _this.delPost({
          file: f
        });
      });
    },
    delPost: function(search, callback) {
      return env.blog.findModels(search, {}, function(post) {
        if (post) {
          return post.remove();
        } else {
          return helpers.cbc(callback);
        }
      });
    },
    getPost: function(search, callback) {
      var found;
      found = false;
      return env.blog.findModels(search, {}, function(post) {
        if (post) {
          if (!found) {
            found = true;
            return callback(void 0, post);
          } else {

          }
        } else {
          if (!found) {
            return callback("not found");
          }
        }
      });
    },
    getPosts: function(search, callback) {
      return env.blog.findModels(search, {
        sort: {
          created: -1
        }
      }, callback);
    },
    getPostsByTags: function(search, tags_yes, tags_no, callback) {
      var query;
      if (search == null) {
        search = {};
      }
      if (tags_yes == null) {
        tags_yes = [];
      }
      if (tags_no == null) {
        tags_no = [];
      }
      query = {};
      _.map(tags_yes, function(tag) {
        var ret;
        ret = {};
        ret['tags.' + tag] = true;
        return query = ret;
      });
      _.map(tags_no, function(tag) {
        var ret;
        ret = {};
        ret['tags.' + tag] = {
          "$exists": false
        };
        if (query) {
          return query = {
            "$and": [query, ret]
          };
        } else {
          return query = ret;
        }
      });
      return env.blog.findModels(_.extend(search, query), {
        sort: {
          created: -1
        }
      }, callback);
    },
    getTags: function(search, tags_yes, tags_no, callback) {
      var tagdata;
      if (search == null) {
        search = {};
      }
      if (tags_yes == null) {
        tags_yes = [];
      }
      if (tags_no == null) {
        tags_no = [];
      }
      tagdata = {};
      return this.getPostsByTags({}, tags_yes, tags_no, function(post) {
        var posttags;
        if (!post) {
          callback(helpers.scaleDict(tagdata));
          return;
        }
        posttags = post.get('tags');
        _.map(tags_yes, function(tag) {
          return delete posttags[tag];
        });
        return helpers.countExtend(tagdata, posttags);
      });
    },
    pingFile: function(file, callback) {
      var _this = this;
      return this.getPost({
        file: file
      }, function(err, post) {
        var stat;
        if (err) {
          _this.fileChanged(file, callback);
          return;
        }
        try {
          stat = fs.statSync(file);
          if (post.get('modified') !== stat.mtime.getTime()) {
            return _this.fileChanged(file, callback);
          } else {
            return helpers.cbc(callback);
          }
        } catch (error) {
          console.log("can't read stat");
          return callback("can't read file stat");
        }
      });
    },
    fileChanged: function(file, callback) {
      var data;
      data = this.parseFile(file);
      if (!data) {
        helpers.cbc(callback, true);
        console.log("NO DATA");
        return;
      }
      env.log('updating entry ' + file, {
        file: file
      }, 'info', 'wiki', 'file', 'change');
      return this.getPost({
        file: data.file
      }, function(err, post) {
        if (post) {
          post.set(data);
        } else {
          post = new env.blog.models.post(_.extend({
            created: new Date().getTime()
          }, data));
        }
        return post.flush(helpers.cbc(callback));
      });
    },
    parseFile: function(file) {
      var data, manualOptions, match, options, pathtags, stat, tags;
      try {
        stat = fs.statSync(file);
        data = fs.readFileSync(file, 'ascii');
      } catch (error) {
        return void 0;
      }
      match = data.match(/^(.*)\n/);
      if (match) {
        match = match[1];
      } else {
        return {
          data: data,
          extraopts: {}
        };
      }
      try {
        manualOptions = eval("x=" + match);
        data = data.replace(/^.*\n/, '');
      } catch (error) {
        manualOptions = {};
      }
      options = {
        modified: stat.mtime.getTime(),
        file: file,
        link: file,
        title: path.basename(file, path.extname(file)).replace(/_/g, ' '),
        body: data,
        tags: []
      };
      options = _.extend(options, manualOptions);
      pathtags = file.split('/');
      pathtags.pop();
      pathtags.shift();
      tags = {};
      _.map(pathtags.concat(options.tags), function(tag) {
        return tags[tag] = true;
      });
      options.tags = tags;
      return options;
    }
  });

  initRoutes = function(callback) {
    var parseTagsString, serveposts;
    env.app.get('/', function(req, res) {
      return res.render('index', {
        title: 'lesh.sysphere.org'
      });
    });
    parseTagsString = function(tags) {
      var tags_no, tags_yes;
      if (!tags) {
        return [[], []];
      }
      tags = "+" + tags;
      tags = tags.replace('+', ' +');
      tags = tags.replace('-', ' -');
      tags_yes = _.map(tags.match(/(?:\+)(\w*)\w/g), function(tag) {
        return tag.replace('+', '');
      });
      tags_no = _.map(tags.match(/\-(\w*)\w/g), function(tag) {
        return tag.replace('-', '');
      });
      return [tags_yes, tags_no];
    };
    serveposts = function(posts, res) {
      return res.render('blog', {
        title: 'blog',
        posts: posts,
        helpers: helpers
      });
    };
    env.app.get('/blog', function(req, res) {
      var posts;
      posts = [];
      return env.wiki.getPosts({
        "tags.blog": true
      }, function(post) {
        if (post) {
          return posts.push(post.output(['blog']));
        } else {
          return serveposts(posts, res);
        }
      });
    });
    env.app.get('/projects', function(req, res) {
      var posts;
      posts = [];
      return env.wiki.getPosts({
        "tags.project": true,
        "tags.mainpage": true
      }, function(post) {
        if (post) {
          return posts.push(post.output(["project", "mainpage"]));
        } else {
          return res.render('projects', {
            title: 'projects',
            posts: posts,
            helpers: helpers
          });
        }
      });
    });
    env.app.get('/article/*', function(req, res) {
      var posts, serve;
      serve = function(posts) {
        return res.render('blog', {
          title: 'blog',
          posts: posts,
          helpers: helpers
        });
      };
      posts = [];
      console.log('looking for', {
        file: req.params[0]
      });
      return env.wiki.getPosts({
        file: req.params[0]
      }, function(post) {
        if (post) {
          return posts.push(post.output());
        } else {
          if (posts.length) {
            return serveposts(posts, res);
          } else {
            return res.end('404');
          }
        }
      });
    });
    env.app.get('/tag/:tags?*', function(req, res) {
      var posts, tags_no, tags_yes, _ref;
      posts = [];
      _ref = parseTagsString(req.params.tags), tags_yes = _ref[0], tags_no = _ref[1];
      return env.wiki.getPostsByTags({}, tags_yes, tags_no, function(post) {
        if (post) {
          return posts.push(post.output(tags_yes));
        } else {
          return serveposts(posts, res);
        }
      });
    });
    env.app.get('/posts', function(req, res) {
      return env.wiki.getPosts({}, function(post) {
        if (post) {
          console.log('sending', post.attributes);
          return res.write(JSON.stringify(post.output()) + "\n");
        } else {
          return res.end();
        }
      });
    });
    callback();
    env.app.get('/tagcloud/:tags?*', function(req, res) {
      var posts, tagdata, tags_no, tags_yes, _ref;
      posts = [];
      tagdata = {};
      _ref = parseTagsString(req.params.tags), tags_yes = _ref[0], tags_no = _ref[1];
      return env.wiki.getPostsByTags({}, tags_yes, tags_no, function(post) {
        var posttags;
        if (!post) {
          tagdata = helpers.scaleDict(tagdata);
          console.log("tagdata", tagdata);
          res.render('tagcloud', {
            title: 'tagcloud',
            posts: posts,
            helpers: helpers,
            tags: tagdata,
            currenturl: req.params.tags || ""
          });
          return;
        }
        posts.push(post.output(tags_yes));
        posttags = post.get('tags');
        _.map(tags_yes, function(tag) {
          return delete posttags[tag];
        });
        return helpers.countExtend(tagdata, posttags);
      });
    });
    env.app.get('/posts', function(req, res) {
      return env.wiki.getPosts({}, function(post) {
        if (post) {
          console.log('sending', post.attributes);
          return res.write(JSON.stringify(post.output()) + "\n");
        } else {
          return res.end();
        }
      });
    });
    return callback();
  };

  initRss = function(callback) {
    env.rssfeed = new rss({
      title: 'lesh blog',
      description: '2blog',
      feed_url: 'http://lesh.sysphere.org/blog/rss.xml',
      site_url: 'http://lesh.sysphere.org',
      author: 'lesh'
    });
    return callback();
  };

  initWiki = function(callback) {
    env.wiki = new Wiki({
      dir: settings.postsfolder
    });
    return callback();
  };

  init = function(callback) {
    return async.auto({
      logger: function(callback) {
        return initLogger(env, callback);
      },
      database: ['logger', wraplog('database', initDb)],
      collections: ['database', wraplog('collections', initCollections)],
      wiki: ['collections', wraplog('wiki', initWiki)],
      express: ['database', 'logger', wraplog('express', initExpress)],
      routes: ['express', 'wiki', 'rss', wraplog('routes', initRoutes)],
      rss: ['collections', 'wiki', wraplog('rss', initRss)]
    }, callback);
  };

  init(function(err, data) {
    if (!err) {
      return env.log('system initialized', {}, 'info', 'init', 'done');
    } else {
      return env.log('system init failed', {}, 'info', 'init', 'error');
    }
  });

}).call(this);

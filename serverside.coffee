path = require 'path'
fs = require 'fs'
crypto = require 'crypto'
async = require 'async'
_ = require 'underscore'

mongodb = require 'mongodb'
http = require 'http'
express = require 'express'
ejslocals = require 'ejs-locals'

logger = require 'logger'
comm = require 'comm/serverside'
helpers = require 'helpers'

decorators = require 'decorators'
decorate = decorators.decorate

hound = require 'hound'

pagedown = require 'pagedown'
converter = pagedown.getSanitizingConverter()

env = {}

settings = postsfolder: "posts"

ejslocals.ejs.filters.prettyDate = (obj) -> 
    helpers.prettyDate(obj)


initLogger = (callback) ->
    env.logger = new logger.logger()
    env.consoleLogger = new logger.consoleLogger()
    env.logger.pass()
    env.logger.connect(env.consoleLogger)
    env.log = env.logger.log.bind(env.logger)
    env.log('logger initialized', {}, 'init','info')
    callback()

initDb = (callback) ->
    env.db = new mongodb.Db 'blog', new mongodb.Server('localhost', 27017), safe: true
    env.db.open callback

initCollections = (callback) ->
    env.blog = new comm.MongoCollectionNode db: env.db, collection: 'blog'
    env.post = env.blog.defineModel 'post',
        output: ->
            id: @attributes.id
            time: @attributes.created
            tags: [ 'some', 'tag' ]
            title: @attributes.title
            body: converter.makeHtml(@attributes.body)
    callback()

initExpress = (callback) ->
    env.app = app = express()
            
    app.configure ->
        app.engine 'ejs', ejslocals.render
        app.set 'view engine', 'ejs'
        app.set 'views', __dirname + '/views'
        app.use express.favicon()
        app.use express.logger('dev')
        app.use express.bodyParser()
        app.use express.methodOverride()
        app.use app.router
        app.use express.static(__dirname + '/static')
        app.use (err, req, res, next) ->
            env.log 'web request error', { stack: err.stack }, 'error', 'http'
            res.send 500, 'BOOOM!'

    env.server = http.createServer env.app
    env.server.listen 3333
    env.log 'http server listening', {}, 'info', 'init', 'http'
    callback undefined, true


makeLogDecorator = (name) -> 
    (f,callback,args...) ->
        f (err,data) ->
            if not err
                env.log(name + ' ready', {}, 'info', 'init', 'done', name)
            else
                env.log(name + ' failed!', {}, 'info', 'init', 'error', name)
            callback(err,data)

wraplog = (name,f) -> decorators.decorate makeLogDecorator(name), f


# this chould be a msgnode.. 
watchDir = (callback) ->
    watcher = hound.watch(settings.postsfolder)

    watcher.on "create", (f,stat) ->
        if stat.isFile()
            env.log('created file ' + f, { file: f }, 'info', 'fs', 'file', 'create')
            createPost(f)
        else
            env.log('created dir ' + f, { file: f }, 'info', 'fs', 'dir', 'create')
            
    watcher.on "change", (f,stat) ->
        env.log('file changed ' + f, { file: f }, 'info', 'fs', 'file', 'change')
        updatePost(f)
        
    watcher.on "delete", (f,stat) ->
        env.log('deleted file ' + f, { file: f }, 'info', 'fs', 'file', 'delete')
        deletePost(f)
        
    callback()


deletePost = decorate decorators.MakeDecorator_Throttle({timeout: 200}), (file, callback) ->
    env.blog.findModels {file: file}, {}, (post) ->
        if post then post.remove() else helpers.cbc(callback)


updatePost = decorate decorators.MakeDecorator_Throttle({timeout: 200}), (file, id, callback) ->
    try
        data = fs.readFileSync file, 'ascii'
    catch error
        helpers.cbc callback, error
        
    env.blog.findModels {file: file}, {}, (post) -> if post then post.set({body: data}); post.flush() else helpers.cbc(callback)

createPost = decorate decorators.MakeDecorator_Throttle({timeout: 200}), (file, id, callback) ->
    try
        stat = fs.statSync(file)
        data = fs.readFileSync file, 'ascii'
    catch error
        helpers.cbc callback, error

    post = new env.blog.models.post
        created: stat.ctime.getTime()
        modified: stat.ctime.getTime()
        file: file
        title: file.replace(/_/g,' ')
        body: data
            
    post.flush -> helpers.cbc(callback)


getPosts = (search,callback) -> env.blog.findModels search,{},callback

initRoutes = (callback) ->
    env.app.get '/', (req,res) ->
      res.render 'index', { title: 'hello there' }

    env.app.get '/blog', (req,res) ->
        serve = (posts) -> res.render 'blog', { title: 'blog', posts: posts, helpers: helpers }            

        posts = []
        getPosts {}, (post) ->
            if post then posts.push post.output() else serve(posts)

    env.app.get '/posts', (req,res) ->
        getPosts {}, (post) ->
            if post
                console.log('sending',post.attributes)
                res.write JSON.stringify(post.output()) + "\n"
            else
                res.end()
    callback()




init = (callback) ->
    async.auto        
        logger: initLogger
        database: [ 'logger', wraplog('database', initDb) ]
        collections: [ 'database', wraplog('collections', initCollections) ]
        express: [ 'database', 'logger', wraplog('express',initExpress) ]
        routes: [ 'express', wraplog('routes',initRoutes) ]
        watchDir: [ 'collections', wraplog('watchDir', watchDir) ]
        callback

init ->
    env.log 'system initialized',{}, 'info','init','done'



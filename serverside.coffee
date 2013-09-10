path = require 'path'
fs = require 'fs'
crypto = require 'crypto'
async = require 'async'
_ = require 'underscore'
Backbone = require 'backbone4000'

mongodb = require 'mongodb'
http = require 'http'
express = require 'express'
ejs = require 'ejs'
ejslocals = require 'ejs-locals'

collections = require 'collections/serverside'
helpers = require 'helpers'

decorators = require 'decorators'
decorate = decorators.decorate

hound = require 'hound'
xml = require 'xml'

pagedown = require 'pagedown'
converter = new pagedown.Converter()

env = {}

rfc822 = require './rfc822'

settings =
    postsfolder: "posts"
    privatetags: [ "secret_tag", "secret_tag2" ]
    users:
        some_key: { user: 'username', tags: [ "secret_tag" ] }

settings = helpers.extend require('./settings').settings # recursive extend 

# switch tag arrays to tag dictionaries
settings.privatetags = helpers.arrayToDict settings.privatetags
_.map settings.users, (userdata,key) -> console.log key, userdata; userdata.tags = helpers.arrayToDict userdata.tags

console.log "setings:", JSON.stringify(settings)

ejs.filters.prettyDate = (obj) -> helpers.prettyDate(obj)

initLogger = (env,callback) ->    
    env.log = (text,data,taglist...) ->
        tags = {}
        _.map taglist, (tag) -> tags[tag] = true
        if tags.error then text = text.red
        if tags.error and _.keys(data).length then json = " " + JSON.stringify(tags.error) else json = ""
        console.log String(new Date()).yellow + " " + _.keys(tags).join(', ').green + " " + text + json

    env.logres = (name, callback) ->
        (err,data) -> 
            if (err)
                env.log name + ': ' + err, {error: err}, 'init', 'fail'
            else
                env.log name + "...", {}, 'init', 'ok'
            callback(err,data)
        
    env.log('logger initialized', {}, 'init','info')

    callback()


initDb = (callback) ->
    env.db = new mongodb.Db 'blog', new mongodb.Server('localhost', 27017), safe: true
    env.db.open callback

initCollections = (callback) ->
    env.blog = new collections.MongoCollection db: env.db, collection: 'blog'
    env.post = env.blog.defineModel 'post',
        output: (ignoretags) ->
            if not @attributes.tags then return { tags: []}
            id: @attributes.id
            created: @attributes.created
            modified: @attributes.modified
            tags: _.without.apply(this, [ _.keys(@attributes.tags) ].concat(ignoretags)) # blah
            title: @attributes.title
            link: @attributes.file
            body: converter.makeHtml(@attributes.body)
    callback()

initExpress = (callback) ->
    env.app = app = express()
    app.configure ->
        app.engine 'ejs', ejslocals
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

Wiki = Backbone.Model.extend4000
    initialize: ->
        @when 'dir', (dir) =>
            @watchDir dir
            @crawlDir dir, (file) => @pingFile(file)
                
    crawlDir: (dir,callback) ->
        fs.readdir dir, (err,files) =>
            if err then return
            _.map files, (file) =>
                if not @checkIgnores(file) then return
                file = path.normalize(dir + "/" + file)
                stat = fs.statSync(file)
                if stat.isDirectory() then @crawlDir file, callback
                if stat.isFile() then helpers.cbc callback, file
                    
    checkIgnores: (f) -> if f.indexOf('.git') isnt -1 or f.indexOf('.#') isnt -1 then return false else return true # stupid for now

    watchDir: (dir) ->
        watcher = hound.watch(dir)

        hound.ignore = (f) => @checkIgnores(f)

        watcher.on "create", (f,stat) =>
            if not @checkIgnores(f) then return
            if stat.isFile()
                env.log('created file ' + f, { file: f }, 'info', 'fs', 'file', 'create')
                @fileChanged(f)
            else
                env.log('created dir ' + f, { file: f }, 'info', 'fs', 'dir', 'create')
                
        watcher.on "change", (f,stat) =>
            if not @checkIgnores(f) then return
            env.log('file changed ' + f, { file: f }, 'info', 'fs', 'file', 'change')
            setTimeout @fileChanged(f), 500
            
        watcher.on "delete", (f,stat) =>
            if not @checkIgnores(f) then return
            env.log('deleted file ' + f, { file: f }, 'info', 'fs', 'file', 'delete')
            @delPost { file: f }
        
    delPost: (search, callback) ->
        env.blog.findModels search, {}, (post) ->
            if post then post.remove() else helpers.cbc(callback)

    getPost: (search, callback) ->
        found = false
        env.blog.findModels search, {}, (post) ->
            if post
                if not found then found = true; callback undefined, post else return;
            else
                if not found then callback "not found"

    getPosts: (search,callback) -> env.blog.findModels search, {sort: {created: -1}}, callback

    getPostsByTags: (search = {}, tags_yes=[], tags_no=[], callback) ->
        query = {}

        if tags_yes.constructor isnt Array then tags_yes = _.keys(tags_yes)
        if tags_no.constructor isnt Array then tags_no = _.keys(tags_no)

        console.log "rendering tags: ", tags_yes, tags_no
            
        _.map tags_yes, (tag) ->
            ret = {}; ret['tags.' + tag] = true
            query = ret

        _.map tags_no, (tag) ->
            ret = {}; ret['tags.' + tag] = { "$exists" : false }
            if query then query = { "$and" : [query, ret] } else query = ret

        #console.log "query is:", JSON.stringify(query)
        
        env.blog.findModels _.extend( search, query ), {sort: {created: -1}}, callback
        
    pingFile: (file,callback) ->
        @getPost {file: file}, (err,post) =>
            if err then @fileChanged(file,callback); return
            try
                stat = fs.statSync(file)
                if post.get('modified') != stat.mtime.getTime() then @fileChanged(file,callback) else helpers.cbc callback
            catch error
                console.log("can't read stat")
                callback "can't read file stat"

    fileChanged: (file,callback) ->
        data = @parseFile(file)
        if not data then helpers.cbc callback, true; console.log "NO DATA"; return
        env.log('updating entry ' + file, { file: file }, 'info', 'wiki', 'file', 'change')
        @getPost { file: data.file }, (err,post) ->
            if post then delete data['created']; post.set(data) else post = new env.blog.models.post(data)
            post.flush helpers.cbc callback
    
    parseFile: (file) ->
        # read file contents and stat
        try
            stat = fs.statSync(file)
            data = fs.readFileSync file, 'ascii'
        catch error
            return undefined

        # find the first line of a file and execute it
        match = data.match(/^(.*)\n/)
        if match then match = match[1] else return { data: data, extraopts: {} }
        try
            manualOptions = eval("x=" + match)
            data = data.replace(/^.*\n/,'')
        catch error
            manualOptions = {}  

        # generate basic options
        options =
            created: stat.ctime.getTime()
            modified: stat.mtime.getTime()
            file: file
            link: file
            title: path.basename(file,path.extname(file)).replace(/_/g,' ')
            body: data
            tags: []

        options = _.extend options, manualOptions

        # write options JSON back to the file
        # sooo boring... I'll do this later

        # apply path as tags
        pathtags = file.split('/')
        pathtags.pop()
        pathtags.shift()

        tags = {}
        
        _.map pathtags.concat(options.tags), (tag) ->
            tags[tag] = true
            
        options.tags = tags
        
        return options


initRoutes = (callback) ->
    env.app.get '/', (req,res) ->
      res.render 'index', { title: 'lesh.sysphere.org' }

    parseTagsString = (tags) ->
        if not tags then return [ {}, {} ]
        
        tags = "+" + tags
        tags = tags.replace('+', ' +')
        tags = tags.replace('-', ' -')
        tags_yes = helpers.mapToDict tags.match(/(?:\+)(\w*)\w/g), (tag) -> tag.replace '+', ''
        tags_no = helpers.mapToDict tags.match(/\-(\w*)\w/g), (tag) -> tag.replace '-', ''
        
        [ tags_yes, tags_no ]

    serveposts = (posts,res) -> res.render 'blog', { title: 'blog', posts: posts, helpers: helpers } 

    serveRss = (posts,res,metadata={}) ->

        preparePost = (post) ->
            { item: [
                { title: post.title }
                { link: 'http://lesh.sysphere.org/article/' + post.link }
                { description: post.body }
                { author: 'lesh@sysphere.org (lesh)' }
                { category: post.tags.join(' ') }
                { guid: 'http://lesh.sysphere.org/article/' + post.link }
                { pubDate: rfc822.formatDate(new Date(post.created)) }
            ]}


        channel = [ { title: metadata.title or 'lesh blog' }
            { link: 'http://lesh.sysphere.org/blog' }
            { language: 'en-us' }
            { description: metadata.description or 'lesh blog' }
            ]

        root = rss: [
            { _attr: { version: "2.0" }},
            { channel: channel }
            ]
            

        _.map posts, (post) ->
            channel.push preparePost(post)

        res.header('Content-Type', 'application/xhtml+xml')
        res.end xml( root )
            


    servetags = (tags_yes={}, tags_no={}, key="public", outputType, res) -> 
        posts = []
        tagdata = {}

        
        if tags_yes.constructor isnt Object then tags_yes = helpers.arrayToDict(tags_yes)
        if tags_no.constructor isnt Object then tags_no = helpers.arrayToDict(tags_no)
        _.extend tags_no, if userdata = settings.users[key] then _.omit(settings.privatetags,_.keys(userdata.tags)) else settings.privatetags
        
        console.log "key:", key                
        env.wiki.getPostsByTags {}, tags_yes, tags_no, (post) ->
            if post
                posts.push post.output(tags_yes)
                if outputType is 'tagcloud'
                    posttags = post.get('tags')
                    _.map tags_yes, (tag) -> delete posttags[tag]
                    
                helpers.countExtend tagdata, posttags
            else
                if outputType is 'tagcloud' then tagdata = helpers.scaleDict(tagdata)
                serveposts posts, outputType, res, { tags: tagdata, key: key }



    serveposts = (posts,outputType,res,extraopts={}) ->
        if outputType is 'rss' then return serveRss(posts,res)
        if outputType is 'txt' then return serveTxt(posts,res)
        if not outputType then outputType = 'blog'
        console.log "rendering #{ outputType }"
        res.render outputType, _.extend({ posts: posts, helpers: helpers, _:_, title: 'lesh.sysphere.org ' + outputType, selected: outputType, currenturl: "", selected: outputType, tags: {}, key: 'public' }, extraopts)

                                        
    env.app.get '/:key?/blog/:type?', (req,res) ->
        if req.params.type is 'rss.xml' then outputType = 'rss' else outputType = 'blog'
        servetags ['blog'],[], req.params.key, outputType, res

    env.app.get '/:key?/projects', (req,res) ->
        if req.params.type is 'rss' then outputType = 'rss' else outputType = 'projects'
        servetags ['project','intro'],[], req.params.key, outputType, res

    env.app.get '/:key?/tagcloud/:tags?/:type?', (req,res) ->
        if req.params.type is 'rss.xml' then outputType = 'rss' else outputType = 'tagcloud'        
        [ tags_yes, tags_no ] = parseTagsString req.params.tags
        servetags tags_yes, tags_no, req.params.key, outputType, res

    env.app.get ':key?/article/*', (req,res) ->        
        serve = (posts) -> res.render 'blog', { title: 'blog', posts: posts, helpers: helpers }    
        posts = []
        console.log('looking for', { file: req.params[0] })
        
        env.wiki.getPosts { file: req.params[0] }, (post) ->
            if post then posts.push post.output() else
                if posts.length then serveposts(posts,'blog',res, { selected: '', title: posts[0].title }) else res.end('post not found')
                            
                                                            
initRss = (callback) ->
    callback()
    
initWiki = (callback) ->
    env.wiki = new Wiki {dir: settings.postsfolder}
    callback()


init = (callback) ->
    async.auto        
        logger: (callback) -> initLogger(env,callback)
        database: [ 'logger', wraplog('database', initDb) ]
        collections: [ 'database', wraplog('collections', initCollections) ]
        wiki: [ 'collections', wraplog('wiki', initWiki) ]
        express: [ 'database', 'logger', wraplog('express',initExpress) ]
        routes: [ 'express', 'wiki', 'rss', wraplog('routes',initRoutes) ]
        rss: [ 'collections', 'wiki', wraplog('rss', initRss) ]
        callback

init (err,data) ->
    if not err
        env.log 'system initialized',{}, 'info','init','done'
    else
        env.log 'system init failed',{}, 'info','init','error'



# CouchDB Auto Views #

CouchDB's view engine is extremely flexible. Both map and reduce functions can be defined with the full expressive power of JavaScript, and CouchDB's view queries let you wrangle b+trees in every way possible. Unfortunately, flexibility frequently leads to poor choices on the part of users. Without proper guidance, new CouchDB developers are likely to trip into many of these pitfalls:

  - employing overly complex map functions
  - putting multiple views in one design document so that all are re-indexed if only one is changed
  - using custom JavaScript reduce functions rather than the built-in erlang ones
  - not using arrays for compound keys
  - emiting whole documents as view values rather than using the include_docs flag in queries
  - misunderstanding the relationship between reduce and group_level
  - incorrectly using startkey_docid, skip, reverse, etc.
  - failing to implement a good strategy for keeping design documents in sync with codebase

The couchdb-auto-views module provides helpful mechansims for both *defining* and *querying* CouchDB views without making all the common mistakes.


## AutoView ##

One of the easiest mistakes to make when first designing CouchDB views is to put too much logic in your map functions. On the face of it, the fact that couch lets you use JavaScript to define map functions seems like one of its most powerful features. Unfortunately, every time you update the logic in a view, the whole view index must be invalidated and rebuilt. As your database grows to hundreds of thousands of documents, rebuilding view indexes becomes seriously expensive. In the long run, you will find yourself dumbing down your views and doing more work to prep documents before insertion. Essentially, you'll be moving business logic out of the database and back into your  application where it always belonged.

This is where AutoViews come in. An AutoView is a very simple way to define a CoucDB view from your node application:

    var userDocsByTitle = new AutoView(db, ['userId', 'title'])

This would be roughly equivelant to a view with the following map function (and no reduce function):

    function(doc) {
        if (typeof doc.userId != 'undefined' && typeof doc.title != 'undefined') {
            emit([doc.userId, doc.title], null)
        }
    }

You could use this AutoView to get all documents belonging to a particular user sorted by title like this:

    userDocsByTitle.query().prefix([theUserId]).exec()
    .then(function(rows) {
        ...
    })

The `prefix()` query refinement will correctly set `startkey` and `endkey` in the view query to return only documents whose keys begin with the provided prefix.

Here's the cool part: if you query this AutoView and no corresponding view exists in your CouchDB database, a new design document will be created defining the necessary view before the query is executed. In other words, you never have to manage design documents for AutoViews.

### A More Complex Example ###

Imagine that you have an online game where players have a certain number of game tokens. Tokens are granted to players by inserting documents like this one:

    {
        "playerId" : "bobjones",
        "tokens"   : 5,
        "date"     : "2013-05-26",
        "note"     : "tokens purchased"
    }

When a player spends tokens, they are deducted by inserting a document like this one:

    {
        "playerId" : "bobjones",
        "tokens"   : -2,
        "date"     : "2013-05-26",
        "note"     : "tokens spent"
    }

You can define an AutoView for both listing token transactions AND checking token balance like this:

    var tokensView = new AutoView(db, ['playerId', 'date'], {value: 'tokens', reduce: 'sum'})

The map function for this AutoView would like like this:

    function(doc) {
        if ( typeof doc.playerId != 'undefined' &&
             typeof doc.date != 'undefined' &&
             typeof doc.tokens != 'undefined') {

            emit([doc.playerId, doc.date], doc.tokens)
        }
    }

For its reduce function, this view would use the built-in erlang `_sum` function.

Listing transactions for a player should be familiar:

    tokensView.query().prefix([thePlayerId]).exec()
    .then(function(rows) {
        // include_docs defaults to true for this kind of query,
        // so each row will have the entire document
        rows.forEach(function(row) {
            console.log(row.doc.date, row.doc.tokens, row.doc.note)
        })
    })

Querying a player's current balance is accomplished with the `reduce()` query refinement:

    tokensView.query().prefix([thePlayerId]).reduce().exec()
    .then(function(rows) {
        // the reduce() refinement turns off include_docs and turns on reduce
        console.log('current balance: ' + rows[0].value)
    })

You could even use the same view to list changes in balance by day:

    tokensView.query().prefix([thePlayerId]).group().exec()
    .then(function(rows) {
        // the group() refinement turns off include_docs and turns on reduce and group
        rows.forEach(function(row) {
            console.log(row.key[1], row.value)
        })
    })

### Emitting Multiple Keys for One Document ###

One of CouchDB's most usefull unique features is the ability to emit multiple keys into a view for a single document. AutoViews can be defined to take advantage of this feature. Imagine, for instance, a document that defines multiple phone numbers for a person:

    {
        "firstName" : "Will",
        "lastName"  : "Conant",
        "phones"    : [
            {
                "number" : "8011231234",
                "type"   : "Home"
            },
            {
                "number" : "8015551234",
                "type"   : "Work"
            }
        ]
    }

You can define an AutoView for searching by phone number like this:

    var byPhoneView = new AutoView(db, ['.number', 'lastName'], {each: 'phones'})

This would be equivalent to a view with the following map function:

    function(doc) {
        if (Array.isArray(doc.phones)) {
            doc.phones.forEach(function(item)) {
                if (typeof item.number != 'undefined' && typeof doc.lastName != 'undefined') {
                    emit([item.number, doc.lastName], null)
                }
            })
        }
    }


## API ##

### av = new AutoView(db, key, [{value, reduce, each}])

  - `db` should be a database object obtained from `cot` (see below)
  - `key` must be an array of strings specifying the names of properties to be emitted as the key
  - `value` may be string specifying the name of a property to be emitted as the value
  - `reduce` may be one of `count`, `sum`, or `stats`
  - `each` may be the name of a property containing an array to be looped over for emitting multiple keys per document

Property names must match `/^\w+$/`. If `each` is provided, property names may begin with `.` to indicate properties of items contained in the looped-over array.

The reduce functions correspond to CouchDB's built-in Erlang reduce functions.

You may obtain a `db` object from the `cot` module like this:

    var Cot = require('cot')
    var cot = new Cot({hostname: 'localhost', port: 5984})
    var db = cot.db('my-db-name')

Refer to the Cot documentation for more information: http://github.com/willconant/cot-node

### query = av.query()

Returns a new unrefined query object. A query may be refined by calling a series of chaining methods specifying query parameters. Each refining method will make a fresh copy of the query, so you may safely retain a partially refined query for later use. At each step of refinement, the query will be valid. You can always `exec()` a query. Even one that hasn't been refined at all:

    av.query().exec().then(...)

You execute a query with the `exec()` method which returns a promise.

If you execute a query against an AutoView that does not exist in the database, a deisgn document for that view will be generated before the query is executed.

### newQuery = query.key(key)

Refines `query` to match all rows with the exact key `key`.

### newQuery = query.range(start, end, [inclusiveEnd])

Refines `query` to match all rows with a key >= `start` and < `end`. If `inclusiveEnd` is truthy, query will match rows with a key <= `end`.

### newQuery = query.prefix(prefix)

Refines `query` to match all rows with a key that starts with the given prefix. `prefix` must be an array.

### newQuery = query.reverse()

Refines `query` to reverse row order.

### newQuery = query.page(limit, [lastKey, lastDocId])

Refines `query` to return only `limit` rows. To implement pagination, you may pass `lastKey` and `lastDocId` which should be values from the very last row returned by the previous call to `query.page()`. For instance:

    // load the first page of 5
    query.page(5).exec()
    .then(function(rows) {
        // loads the second page of 5:
        return query.page(5, rows[rows.length-1].key, rows[rows.length-1].id)
    })
    .then(function(rows) {
        console.log(rows)
    })

In practice, this means you can implement a next page link by simply including the last key and last doc id on the current page.

### newQuery = query.noDocs()

Refines `query` to not include the whole document with each row.

### newQuery = query.group([level])

Refines `query` to reduce row values grouped by key. `level` can be provided to control key group level.

### newQuery = query.reduce()

Refines `query` to reduce entire result set into a single row

### promise = query.exec()

Executes query and returns a promise for the results.


## Author ##

Will Conant, http://willconant.com/

## License ##

The couchdb-auto-views module is released under the MIT License.

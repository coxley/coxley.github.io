---
title: "Python Logging: The Missing Guide"
url: "/logging"
date: 2020-04-25T23:28:19-07:00
draft: false
---

Python loggers can be configured a million ways. That’s too much.

We can ease the pain by sticking to consistent practices. These patterns come from the most common issues that I see projects run into.

# Naming

Like modules, loggers are hierarchical. Their names should follow the import path of where they’re running. Loggers that stray from this are hard to work with. Use `__name__` everywhere to get this for free.

Follow this guideline for both libraries and CLI entry-points. Technically the name of `__main__`'s logger doesn’t matter, but inconsistencies tend to spread.

```python
# Module: foo/bar/baz.py

# GOOD: These are equivalent. Use the first one.
LOG = logging.getLogger(__name__)
LOG = logging.getLogger('foo.bar.baz')

# BAD: Cannot predict based on import path.
LOG = logging.getLogger('my_foo_baz')

# BAD: This is the root logger of the hierarchy.
#    : Libraries that use this cannot have their
#    : logs filtered by level without affecting
#    : everything else.
LOG = logging.getLogger()
LOG = logging.getLogger('')
LOG = logging.getLogger(None)
```

As a rule of thumb, just don’t use the root logger. Attach handlers, sure. But don’t use.

# Hierarchy: Handlers & Filters

As a refresher, these settings are available to loggers:

* Min Level
* Handlers
* Filters

Log names, split by period, make up the hierarchy. When logs are issued, they bubble up, visiting each handler, unless stopped by a filter. Or the minimum level.

This makes it handy to do things like:

* Exclude noisy logs from an import
* Include helpful logs from an import
* Format and print all program logs to `stderr`


Let’s demonstrate how this works:

```python
import logging

# Set up silly handler that prints a name it's given when a log arrives
class DumbHandler(logging.Handler):
    def __init__(self, title: str, *args, **kwargs):
        self.title = title
        super().__init__(*args, **kwargs)

    def emit(self, record: logging.LogRecord):
        print(f"{self.title}: {record.getMessage()}")


logging.root == logging.getLogger('')  # True
logging.root.setLevel(logging.DEBUG)   # Default level is WARNING

logging.root.addHandler(DumbHandler('root'))
logging.getLogger('project.foo').addHandler(DumbHandler('project.foo'))

logging.root.info('test')
# root: test

logging.getLogger('project.foo').info('test')
# project.foo: test
# root: test

logging.getLogger('project.foo.bar').setLevel(logging.WARNING)
logging.getLogger('project.foo.bar').info('test')
# <nothing>
```

# Avoid the `self.logger` Pattern

All calls to `logging.getLogger(name)` will return the same logger instance. Storing in an instance variable pollutes the logging call-site — which should be frequent!

```python
# GOOD: At module level after imports
LOG = logging.getLogger(__name__)
def foo():
  LOG.info('...')

# BAD: Adds 8 more chars before message
class Foo:
  def __init__(self):
    self.logger = logging.getLogger(__name__)

  def bar(self):
    self.logger.info('...')

# BAD
def foo(logger: logging.Logger):
  logger.info('...')
```

If you need this to add unique handlers for contextual info, keep reading.

# Adding Context

This can be done in too many ways. For simplicity, I’ll show one method: my favorite.

It optimizes for:

* Zero special logger instances
* Fewest number of Handlers (1)
* No changes at logging call-site

```python
"""
Use `contextvars` to share metadata with your log handler.

This works between imports, threads, and is `asyncio`-friendly.

The main gotcha is putting `copy_context().run` at the
right entry-point(s). And setting the variables soon
enough.
"""

import logging
import time

from contextvars import ContextVar, copy_context
from random import randint

LOG = logging.getLogger(__name__)

ReqID = ContextVar('req_id')

class ContextHandler(logging.Handler):
    def emit(self, record: logging.LogRecord):
        msg = record.getMessage()
        if ReqID.get(None) is not None:
            msg = f"[{ReqID.get()}] {msg}"

        # Don't print.
        # Combine with logging over the network or use
        # a custom formatter attached to StreamHandler
        print(msg)


def do_work():
    LOG.info("starting request...")
    ReqID.set(randint(100, 500))
    LOG.info("request finished")


# If you want to capture more logs from the program, attach handler
# at a higher level in the hierarchy.
#
# Perhaps even logging.root.
LOG.addHandler(ContextHandler())
LOG.setLevel(logging.INFO)
LOG.info("starting program")

copy_context().run(do_work)
copy_context().run(do_work)
copy_context().run(do_work)

# starting program
#
# starting request...
# [484] request finished
#
# starting request...
# [105] request finished
#
# starting request...
# [381] request finished
```


For more information on `contextvars`, see: https://docs.python.org/3/library/contextvars.html

# Logging Over the Network

Use a queue with a flusher thread.

For every log issued, all handlers are run serially in the same thread as the call-site. Uploading messages to a database in-line turns microseconds into 20ms, 100ms, 500ms, and so on.

A project I worked on did this once. Jobs that landed in Europe took significantly longer to run. We figured out it was due to 500-1000ms round-trips for each log message.


```python
import logging
import threading
from queue import Queue

LOG = logging.getLogger(__name__)

class DBHandler(logging.Handler):
    def __init__(self, q: Queue, *args, **kwargs):
        self.q = q
        super().__init__(*args, **kwargs)

    def emit(self, record: logging.LogRecord):
        # Format, convert log record to row, and send to queue
        # for insertion
        self.format(record)
        row = make_row(record)
        self.q.put(row)


def make_row(record: logging.LogRecord) -> "Row":
    # Use more columns than this
    return {"msg": record.message}


def flusher(q: Queue):
    # Upload row instead of print. Perhaps flush every n-seconds
    # w/ buffer to have an upper-bound on inserts.
    while True:
        row = q.get()
        print("woohoo, recived:", row["msg"])

q = Queue()
threading.Thread(target=flusher, daemon=True, args=(q,)).start()
LOG.setLevel(logging.INFO)
LOG.addHandler(DBHandler(q))

LOG.info("starting program")
LOG.info("doing some stuff")
LOG.info("mighty cool")
# woohoo, recived: starting program
# woohoo, recived: doing some stuff
# woohoo, recived: mighty cool
```

For `asyncio` in the flusher thread, [use `janus.Queue`](https://github.com/aio-libs/janus/). It’s both `asyncio`-compatible and thread-safe: https://gist.github.com/coxley/14a1e3d98898132fa89c4e025cfa840f

# Duplicate Logs in Terminal

When logs print more than once, there are too many `StreamHandlers` attached. Use `logging.removeHandler` for a deterministic starting point.

```python
for h in logging.root.handlers:
  if (
    isinstance(h, logging.StreamHandler) and
    getattr(h, "stream", None) in (sys.stderr, sys.stdout)
  ):
    logging.root.removeHandler(h)

# Add the handler (and formatter) you want
```

Don’t attach `StreamHandler` within libraries. Configure the root logger from the program entry-point.

# secsend

secsend is a file-sharing app providing end-to-end encryption of data. It provides a web application and a command-line interface (CLI).

https://user-images.githubusercontent.com/1874053/188491291-106a232d-db2f-4622-bf8f-f312e1ee1d38.mp4

It has some unique features:

* on-the-fly encryption and decryption in the browser. For instance,
  a movie can be directly decrypted in the browser without having to be
  downloaded first.
* multi-files upload: on-the-fly creation of Zip archives (without any
  temporary archive creation - webapp only)
* pause & resume uploads
* automatic upload resuming when connection fails or timeouts (webapp only)
* lightweight web application (HTML/CSS/JS in less than 100kb)

On top of that, it supports more classical features, like file size limitation
& timeout.

Please also read the [security considerations
section](#security-considerations) before deployment and usage.

The backend & CLI are written in Python. The web application is written in Typescript.

## Table of contents

* [Server installation &amp; configuration](#server-installation--configuration)
  * [Quick'n'dirty](#quickndirty)
  * [Run with Docker](#run-with-docker)
  * [Run with systemd](#run-with-systemd)
  * [Configuration](#configuration)
* [Command line usage](#command-line-usage)
  * [Installation](#installation)
  * [Upload a file](#upload-a-file)
  * [Download a file](#download-a-file)
  * [Delete an uploaded file](#delete-an-uploaded-file)
* [Security considerations](#security-considerations)


## Server installation & configuration

### Quick'n'dirty

To quickly try secsend, you can run a server directly from your shell:

```
$ pip install secsend_api secsend_webapp
$ sanic secsend_api.prod.app -p 8000
```

You can now access secsend by going to http://127.0.0.1:8000.

Not installing `secsend_webapp` will disable the webapp. Only the [command line
interface](#command-line-usage) will work.

By default, uploaded files will be saved in the directory `secsend_root`,
relative to the current directory.  See [the configuration
section](#configuration) on how to change this behavior, among with other
options (file size & time limit).

### Run with Docker

Copy `docker.env.example` to `docker.env`, and modify its content to configure
secsend (e.g. file size limit).

Then, run secsend with docker:

```
# docker run --env-file docker.env -p 8000:80 -v /path/to/data/storage:/data aguinet/secsend:v1.0.0
```

`/path/to/data/storage` will contain the uploaded files and associated metadata.

If you have changed `SECSEND_LISTEN_PORT` in `docker.env`, change the `-p`
option accordingly.

You can now open http://127.0.0.1:8000 to access secsend!

### Run with systemd

Let's say you want to run secsend on a server using systemd, under the user
`www-send`.

First, create a Python virtualenv and install secsend:

```
$ virtualenv secsend_venv && . secsend_venv/bin/activate
$ pip install secsend_api secsend_webapp
```

Then, declare the secsend service in systemd, by creating the file `/etc/systemd/system/secsend.service` with this content:

```
[Unit]
Description=secsend

[Service]
# Command to execute when the service is started
ExecStart=/path/to/secsend_venv/bin/sanic secsend_api.prod.app -p 8000 -H 127.0.0.1

# Disable Python's buffering of STDOUT and STDERR, so that output from the
# service shows up immediately in systemd's logs
Environment=PYTHONUNBUFFERED=1
Environment=SECSEND_BACKEND_FILES_ROOT=/path/to/data/storage

Restart=always
User=www-send

[Install]
WantedBy=multi-user.target
```

`/path/to/data/storage` must be writable by the `www-send ` user. See the
[configuration section](#configuration) for other environment variable you can declare to
configure secsend.

Finally, enable & run the secsend service:

```
$ systemctl enable --now secsend.service
```

secsend is now accessible at http://127.0.0.1:8000.

### Configuration

secsend can be configured through various environment variables:

* `SECSEND_FILESIZE_LIMIT`: maximum file size in bytes. 0 means no limit.
* `SECSEND_TIMEOUT_S_VALID`: valid time limits, as a comma-separated list of seconds. 0 seconds means no limit.
* `SECSEND_BACKEND_FILES_ROOT`: path to secsend's data storage

## Command line usage

### Installation

```bash
$ pip install secsend
```

### Upload a file

```
$ secupload myvideo.mp4 https://send.domain.com
```

`secupload` will generate two links:

* an administration link that can be used to resume or delete this file
* a download link you can give to the recipients of this file

Use the `-c` flag to resume an upload, using an administration link:

```
$ secupload -c myvideo.mp4 https://send.domain.com/dl?id=XXXXXX#YYYYY
```

### Download a file

```
$ secdownload https://send.domain.com/dl?id=XXXXXX#YYYYY
```

By default, the original filename will be used as the destination filename. Use
`-o` to override this.

### Delete an uploaded file

```
$ secadmin -d https://send.domain.com/dl?id=XXXXXX#YYYYY
```

You need to use an [administration link](#upload-a-file) for this to work.

## Security considerations

### Attack models

#### Passive attacker

In this attack model, we consider that the attacker has access to the files
that the server receives.

In this model, end-to-end encryption is efficient, as the server (in theory)
does not own any secret to decrypt and/or tamper the transmitted files. Also,
he can't inject malicious Javascript as in the active attacker model described
below.

#### Active attacker

In this attack model, the attacker has full control over the server, or
communications between clients and the server. It means that it can, among
other things, deliver compromised Javascript to clients.

### Web application

In the [active attacker model](#active-attacker), where we consider that the
server is compromised and/or malicious, compromised javascript can be shipped
to clients. That Javascript code could thus leak decryption keys to the attacker.

This is a [general and known
problem](https://www.pageintegrity.net/browsercrypto.php#thebrowsercryptochickenandeggproblem)
with web application applications that are doing client-side encryption.

For setups that needs a high level of confidentiality and do not want to trust
the server secsend is deployed onto, it is highly recommended to use the
[command line interface](#command-line-usage) for both the sending and
receiving parties.

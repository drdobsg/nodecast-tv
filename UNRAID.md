# Installing NodeCast TV on Unraid

NodeCast TV can be installed on Unraid either from the published container image or by building the image locally on the server.

## Option 1: Install From The Unraid Template

1. Copy `unraid/nodecast-tv.xml` to the Unraid flash templates directory:

   ```bash
   /boot/config/plugins/dockerMan/templates-user/my-nodecast-tv.xml
   ```

2. In the Unraid web UI, go to **Docker -> Add Container**.
3. Choose `nodecast-tv` from the template dropdown.
4. Set **JWT Secret** to a long random string.
5. Confirm the appdata paths:

   ```text
   /mnt/user/appdata/nodecast-tv/data
   /mnt/cache/appdata/nodecast-tv/transcode-cache
   ```

6. Confirm Intel ARC settings:

   ```text
   LIBVA_DRIVER_NAME=iHD
   HW_DEVICE=/dev/dri/renderD128
   Extra Parameters: --device=/dev/dri:/dev/dri
   ```

7. Apply the template and open `http://UNRAID-IP:3000`.

## Intel ARC Render Node

On the Unraid host, list the render devices:

```bash
ls -l /dev/dri
```

If there is only `renderD128`, keep `HW_DEVICE=/dev/dri/renderD128`. If there are multiple render nodes, set `HW_DEVICE` to the ARC device, often `/dev/dri/renderD129`.

`vainfo` is installed inside the NodeCast TV container, not necessarily on the Unraid host. After the container starts, verify hardware access with:

```bash
docker exec -it nodecast-tv vainfo --display drm --device /dev/dri/renderD128
docker exec -it nodecast-tv sh -lc "ffmpeg -hide_banner -encoders | grep -E 'vaapi|qsv'"
```

Change the render node in those commands if your ARC card uses a different node.

## Optional SSO

SSO is disabled by default. To enable it, fill in the OIDC variables in the Unraid template:

```text
OIDC_ISSUER_URL
OIDC_CLIENT_ID
OIDC_CLIENT_SECRET
OIDC_CALLBACK_URL
```

The callback URL should usually be:

```text
https://your-nodecast-host.example.com/api/auth/oidc/callback
```

## Option 2: Build Locally On Unraid

Use this if your changes are not published to `ghcr.io` yet.

1. Copy this repository to your Unraid server.
2. From the repo directory, build the image:

   ```bash
   docker build -t nodecast-tv:local .
   ```

3. In the Unraid template, change **Repository** from:

   ```text
   ghcr.io/technomancer702/nodecast-tv:latest
   ```

   to:

   ```text
   nodecast-tv:local
   ```

4. Apply the template.

## Option 3: Publish A GHCR Image

This repo includes `.github/workflows/docker-publish.yml`, which publishes to GitHub Container Registry when changes are pushed to `main`, tags are pushed, or the workflow is run manually.

After pushing to your GitHub fork, use your image in the Unraid template:

```text
ghcr.io/YOUR_GITHUB_USER/nodecast-tv:latest
```

If the package is private, make it public in GitHub package settings or log Unraid into GHCR before pulling.

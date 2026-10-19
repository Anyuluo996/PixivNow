import { formatInTimeZone } from 'date-fns-tz'
import { PXIMG_BASEURL_I, pixivFetch } from '~~/server/utils/pixiv'
import type { Artwork } from '~~/shared/types/Artworks'

type ArtworkOrAd = Artwork | { isAdContainer: boolean }

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const requestImage =
    (getHeader(event, 'accept')?.includes('image') ||
      query.format === 'image') &&
    query.format !== 'json'

  const { data, status } = await pixivFetch({
    event,
    url: '/ajax/illust/discovery',
    params: {
      mode: query.mode ?? 'safe',
      max: requestImage ? '1' : ((query.max as string) ?? '18'),
    },
  })

  if (status !== 200) {
    throw createError({ statusCode: status, data })
  }

  let illusts = ((data as { illusts?: ArtworkOrAd[] }).illusts ?? []).filter(
    (value): value is Artwork => Object.keys(value).includes('id')
  )

  // Anonymous requests get an ads-only discovery payload from pixiv (login
  // cookies are forwarded, so logged-in users are unaffected); fall back to
  // probing random illust IDs through the anonymous-friendly detail endpoint.
  if (!illusts.length) {
    const wantR18 = query.mode === 'all'
    for (let attempt = 0; attempt < 4 && !illusts.length; attempt++) {
      const randomId = 20_000_000 + Math.floor(Math.random() * 118_000_000)
      const detail = await pixivFetch({
        event,
        url: `/ajax/illust/${randomId}`,
      })
      const body = (detail.data as any)?.body
      if (
        detail.status !== 200 ||
        body?.illustId == null ||
        body?.urls?.regular == null
      ) {
        continue
      }
      if (!wantR18 && body.xRestrict !== 0) {
        continue
      }
      illusts.push({
        id: String(body.illustId),
        updateDate: body.uploadDate,
        urls: Object.fromEntries(
          Object.entries(body.urls).map(([key, value]) => [
            key,
            String(value).replace(
              /^https:\/\/i\.pximg\.net\//,
              PXIMG_BASEURL_I
            ),
          ])
        ),
      } as unknown as Artwork)
    }
  }

  illusts.forEach((value) => {
    if (value.urls?.regular) {
      return // fallback probes already carry complete urls
    }
    const middle = `img/${formatInTimeZone(
      value.updateDate,
      'Asia/Tokyo',
      'yyyy/MM/dd/HH/mm/ss'
    )}/${value.id}`
    value.urls = {
      mini: `${PXIMG_BASEURL_I}c/48x48/img-master/${middle}_p0_square1200.jpg`,
      thumb: `${PXIMG_BASEURL_I}c/250x250_80_a2/img-master/${middle}_p0_square1200.jpg`,
      small: `${PXIMG_BASEURL_I}c/540x540_70/img-master/${middle}_p0_master1200.jpg`,
      regular: `${PXIMG_BASEURL_I}img-master/${middle}_p0_master1200.jpg`,
      original: `${PXIMG_BASEURL_I}img-original/${middle}_p0.jpg`,
    }
  })

  if (requestImage) {
    const url = illusts[0]?.urls?.regular
    if (!url) {
      throw createError({ statusCode: 404, message: 'No image found' })
    }
    // i.pximg.net 403s direct hits (hotlink protection); route through the
    // site's own /-/ proxy, which rewrites the referer to pixiv.net
    return sendRedirect(event, url.replace(/^https:\/\/i\.pximg\.net\//, '/-/'))
  } else {
    return illusts
  }
})

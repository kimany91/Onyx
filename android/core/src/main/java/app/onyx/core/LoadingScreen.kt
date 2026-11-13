package app.onyx.core

import android.animation.ValueAnimator
import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.view.animation.LinearInterpolator
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.max

/**
 * Écran de chargement cinématique : images du titre en fondu avec un lent zoom (Ken Burns),
 * logo, et une vraie barre de progression en 4 étapes jusqu'à la première image.
 */
class LoadingScreen(private val act: Activity) {

    companion object {
        private val cache = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
            override fun sizeOf(key: String, value: Bitmap) = value.byteCount
        }
        val STEPS = arrayOf("Sources", "Vérification", "Connexion", "Mise en mémoire")
        private val APPLE = PathInterpolator(0.32f, 0.72f, 0f, 1f)
    }

    private val main = Handler(Looper.getMainLooper())
    val view = FrameLayout(act).apply { setBackgroundColor(Color.BLACK); isClickable = false }
    private val imgA = ImageView(act).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0f }
    private val imgB = ImageView(act).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0f }
    private val logo = ImageView(act).apply { scaleType = ImageView.ScaleType.FIT_START; adjustViewBounds = true; alpha = 0f }
    private val title = TextView(act)
    private val subtitle = TextView(act)
    private val stageLabel = TextView(act)
    private val percent = TextView(act)
    private val detail = TextView(act)
    private val bar = Bar(act)
    private val stepViews = ArrayList<TextView>()
    private val info = LinearLayout(act)

    private var images: List<String> = emptyList()
    private var slide = 0
    private var front = imgA
    private var shown = 0f
    private var target = 0f
    private var stage = -1
    private var anim: ValueAnimator? = null
    private var urlKey = ""

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, act.resources.displayMetrics).toInt()

    init {
        val mp = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        view.addView(imgA, mp); view.addView(imgB, FrameLayout.LayoutParams(mp))
        // dégradés cinéma : bas et gauche sombres pour la lisibilité
        view.addView(View(act).apply {
            background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xF5000000.toInt(), 0x99000000.toInt(), 0x22000000, 0x55000000))
        }, FrameLayout.LayoutParams(mp))
        view.addView(View(act).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xCC000000.toInt(), 0x33000000, 0x00000000))
        }, FrameLayout.LayoutParams(mp))

        info.orientation = LinearLayout.VERTICAL
        info.alpha = 0f
        info.translationY = dp(24f).toFloat()
        info.addView(logo, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(84f)).apply { bottomMargin = dp(6f) })
        title.apply { setTextColor(Color.WHITE); textSize = 34f; typeface = Typeface.create("sans-serif", Typeface.BOLD); maxLines = 2; letterSpacing = -0.01f }
        info.addView(title)
        subtitle.apply { setTextColor(0xFFC8C8D0.toInt()); textSize = 16f; maxLines = 1 }
        info.addView(subtitle, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4f) })

        val head = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.BOTTOM }
        stageLabel.apply { setTextColor(Color.WHITE); textSize = 15f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL) }
        percent.apply { setTextColor(0xFFE6E6EA.toInt()); textSize = 15f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL); gravity = Gravity.END }
        head.addView(stageLabel, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        head.addView(percent)
        info.addView(head, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(28f) })
        info.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(10f)).apply { topMargin = dp(10f) })
        detail.apply { setTextColor(0xFF9A9AA4.toInt()); textSize = 13f; maxLines = 1 }
        info.addView(detail, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8f) })

        val steps = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL }
        STEPS.forEachIndexed { i, s ->
            val t = TextView(act).apply { text = s; textSize = 12f; setTextColor(0x66FFFFFF); letterSpacing = 0.04f }
            stepViews.add(t)
            steps.addView(t, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { if (i > 0) leftMargin = dp(18f) })
        }
        info.addView(steps, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(14f) })

        val w = act.resources.displayMetrics.widthPixels
        view.addView(info, FrameLayout.LayoutParams(minOf(w - dp(64f), dp(560f)), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START).apply {
            leftMargin = dp(48f); bottomMargin = dp(44f)
        })
    }

    /** Nouveau titre : images, logo, textes. */
    fun setMedia(name: String, sub: String, logoUrl: String, imgs: List<String>) {
        val key = name + "|" + imgs.joinToString()
        title.text = name
        subtitle.text = sub
        subtitle.visibility = if (sub.isEmpty()) View.GONE else View.VISIBLE
        if (key == urlKey) return
        urlKey = key
        images = imgs.filter { it.isNotEmpty() }.distinct()
        slide = 0
        imgA.alpha = 0f; imgB.alpha = 0f
        logo.alpha = 0f; logo.visibility = View.GONE; title.visibility = View.VISIBLE
        if (logoUrl.isNotEmpty()) load(logoUrl) { bmp ->
            if (bmp != null && bmp.width > 10) {
                logo.setImageBitmap(bmp); logo.visibility = View.VISIBLE; title.visibility = View.GONE
                logo.animate().alpha(1f).setDuration(600).setInterpolator(APPLE).start()
            }
        }
        main.removeCallbacks(nextSlide)
        showSlide()
    }

    fun show() {
        view.animate().cancel()
        view.visibility = View.VISIBLE; view.alpha = 1f; view.scaleX = 1f; view.scaleY = 1f
        shown = 0f; target = 0f; stage = -1; bar.value = 0f
        percent.text = "0 %"
        info.animate().cancel(); info.alpha = 0f; info.translationY = dp(24f).toFloat()
        info.animate().alpha(1f).translationY(0f).setDuration(700).setStartDelay(150).setInterpolator(APPLE).start()
        setStage(0, "Recherche des sources…", null, 0f)
    }

    /** Fin du chargement : la barre se remplit puis l'écran s'efface en douceur sur la vidéo. */
    fun hide() {
        if (view.visibility != View.VISIBLE) return
        progressTo(100f, 3)
        stageLabel.text = "C'est parti"
        main.postDelayed({
            view.animate().alpha(0f).scaleX(1.04f).scaleY(1.04f).setDuration(550).setInterpolator(APPLE)
                .withEndAction { view.visibility = View.GONE; main.removeCallbacks(nextSlide) }.start()
        }, 250)
    }

    val visible get() = view.visibility == View.VISIBLE

    /** Étape (0-3), texte de l'étape, détail réel, progression globale (0-100, jamais en arrière). */
    fun setStage(st: Int, label: String, det: String?, pct: Float) {
        if (st < stage) return
        if (st != stage) {
            stage = st
            stepViews.forEachIndexed { i, t ->
                val col = when { i < st -> 0xCCFFFFFF.toInt(); i == st -> Color.WHITE; else -> 0x55FFFFFF }
                t.setTextColor(col)
                t.typeface = if (i == st) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
                t.text = (if (i < st) "✓ " else "") + STEPS[i]
            }
        }
        stageLabel.text = label
        if (det != null) detail.text = det
        progressTo(pct, st)
    }

    fun setDetail(det: String) { detail.text = det }

    /** Nouvelle source (changement de langue, source suivante) : on revient honnêtement à l'étape donnée. */
    fun rewind(st: Int, pct: Float, label: String) {
        if (st < stage || pct < target) {
            anim?.cancel()
            stage = -1; target = pct; shown = pct
            bar.value = pct / 100f; percent.text = pct.toInt().toString() + " %"
        }
        setStage(st, label, "", pct)
    }

    private fun progressTo(p: Float, st: Int) {
        val t = p.coerceIn(0f, 100f)
        if (t <= target) return
        target = t
        anim?.cancel()
        anim = ValueAnimator.ofFloat(shown, target).apply {
            duration = 450
            interpolator = DecelerateInterpolator()
            addUpdateListener { a -> shown = a.animatedValue as Float; bar.value = shown / 100f; percent.text = shown.toInt().toString() + " %" }
            start()
        }
    }

    /* ---------- Diaporama Ken Burns ---------- */
    private val nextSlide = Runnable { showSlide() }

    private fun showSlide() {
        if (images.isEmpty()) return
        val url = images[slide % images.size]
        slide++
        load(url) { bmp ->
            if (bmp == null) { if (images.size > 1) main.postDelayed(nextSlide, 300); return@load }
            val back = if (front === imgA) imgB else imgA
            back.setImageBitmap(bmp)
            back.animate().cancel()
            // départ et sens de déplacement alternés pour un effet « caméra »
            val dir = if (slide % 2 == 0) 1f else -1f
            back.scaleX = 1.06f; back.scaleY = 1.06f
            back.translationX = -dir * dp(14f); back.translationY = dp(6f).toFloat()
            back.alpha = 0f
            back.bringToFront(); view.getChildAt(0)
            reorder()
            back.animate().alpha(1f).setDuration(1400).setInterpolator(APPLE).start()
            back.animate().scaleX(1.17f).scaleY(1.17f).translationX(dir * dp(14f)).translationY(-dp(6f).toFloat())
                .setDuration(7500).setInterpolator(LinearInterpolator()).start()
            front.animate().alpha(0f).setDuration(1400).setStartDelay(200).start()
            front = back
            if (images.size > 1) main.postDelayed(nextSlide, 5200)
        }
    }

    /** Garde les dégradés et le texte au-dessus des images. */
    private fun reorder() {
        val keep = ArrayList<View>()
        for (i in 0 until view.childCount) { val c = view.getChildAt(i); if (c !== imgA && c !== imgB) keep.add(c) }
        keep.forEach { it.bringToFront() }
    }

    private fun load(url: String, cb: (Bitmap?) -> Unit) {
        cache.get(url)?.let { cb(it); return }
        Thread {
            var bmp: Bitmap? = null
            try {
                val c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = 6000; c.readTimeout = 9000; c.instanceFollowRedirects = true
                val bytes = c.inputStream.use { it.readBytes() }
                val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
                var sample = 1
                while (o.outWidth / (sample * 2) >= 1600) sample *= 2
                bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
                bmp?.let { cache.put(url, it) }
            } catch (_: Exception) { }
            main.post { cb(bmp) }
        }.start()
    }

    /** Barre de progression fine, arrondie, avec un reflet qui glisse. */
    private class Bar(ctx: Context) : View(ctx) {
        var value = 0f
            set(v) { field = v.coerceIn(0f, 1f); invalidate() }
        private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x33FFFFFF }
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        private val glowP = Paint(Paint.ANTI_ALIAS_FLAG)
        private var phase = 0f
        private val shimmer = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 1600; repeatCount = ValueAnimator.INFINITE; interpolator = LinearInterpolator()
            addUpdateListener { phase = it.animatedValue as Float; invalidate() }
        }
        override fun onAttachedToWindow() { super.onAttachedToWindow(); shimmer.start() }
        override fun onDetachedFromWindow() { shimmer.cancel(); super.onDetachedFromWindow() }
        override fun onDraw(c: Canvas) {
            val h = height.toFloat(); val bh = max(4f, h * 0.45f); val top = (h - bh) / 2
            val r = bh / 2
            c.drawRoundRect(RectF(0f, top, width.toFloat(), top + bh), r, r, track)
            val fw = width * value
            if (fw > 0) {
                c.drawRoundRect(RectF(0f, top, fw, top + bh), r, r, fill)
                val x = fw * phase
                glowP.shader = LinearGradient(x - 60f, 0f, x + 60f, 0f, intArrayOf(0x00FFFFFF, 0x99C9D3FF.toInt(), 0x00FFFFFF), null, Shader.TileMode.CLAMP)
                c.drawRoundRect(RectF(0f, top, fw, top + bh), r, r, glowP)
            }
        }
    }
}

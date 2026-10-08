package app.manaorbit;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Shader;

/**
 * Courbe de la valeur pour le grand widget : RemoteViews ne dessine rien lui-même, on lui passe une image (setImageViewBitmap).
 * Même échelle que la courbe de l'appli (valChartHtml, value.js) : temps proportionnel, marge de 14 % autour du min et du max.
 * Partie estimée appli fermée en pointillés. Image bornée (MAX_PX pixels au plus) : elle part vers le lanceur à chaque mise à jour.
 */
final class WidgetChart {

    private WidgetChart() {}

    /** ≈ 320 Ko en ARGB (courbe d'un 4 × 2 à ~80 % de la densité de l'écran) : loin de la limite de mémoire d'images d'un widget (1,5 × l'écran)
     *  et sous le Mo du Binder même si l'image n'y passait pas en mémoire partagée. Au-delà, l'image est réduite puis étirée (trait un peu plus doux). */
    static final int MAX_PX = 80_000;
    private static final int LINE = 0xFF7FB0FF;

    /**
     * t, v : relevés triés par date (au moins 2) ; est[i] : relevé estimé appli fermée. wDp, hDp : place prévue pour l'image.
     * null si rien à dessiner ou en cas d'échec (mémoire) : le widget affiche alors sa légende à la place.
     */
    static Bitmap draw(long[] t, long[] v, boolean[] est, float wDp, float hDp, float density) {
        try {
            int n = t == null ? 0 : t.length;
            if (n < 2 || v.length != n || est.length != n || wDp < 10 || hDp < 10) return null;
            float s = density;
            float px = wDp * s * hDp * s;
            if (px > MAX_PX) s *= (float) Math.sqrt(MAX_PX / px);
            int w = Math.max(20, Math.round(wDp * s)), h = Math.max(12, Math.round(hDp * s));
            long vMin = Long.MAX_VALUE, vMax = Long.MIN_VALUE;
            for (long x : v) {
                vMin = Math.min(vMin, x);
                vMax = Math.max(vMax, x);
            }
            double pad = (vMax - vMin) * 0.14;
            if (pad <= 0) pad = vMax * 0.03;
            if (pad <= 0) pad = 1;
            double lo = vMin - pad, hi = vMax + pad;
            long t0 = t[0], t1 = t[n - 1];
            float left = 4 * s, right = 5 * s, top = 4 * s, bottom = 4 * s;
            float[] xs = new float[n], ys = new float[n];
            for (int i = 0; i < n; i++) {
                double fx = t1 > t0 ? (double) (t[i] - t0) / (t1 - t0) : 1;
                xs[i] = left + (float) ((w - left - right) * fx);
                ys[i] = top + (float) ((h - top - bottom) * (1 - (v[i] - lo) / (hi - lo)));
            }
            // dernier relevé de l'appli : la ligne pleine s'arrête là, les estimations suivent en pointillés
            int solidEnd = n - 1;
            while (solidEnd > 0 && est[solidEnd]) solidEnd--;

            Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(b);
            Path area = new Path();
            area.moveTo(xs[0], h - bottom);
            for (int i = 0; i < n; i++) area.lineTo(xs[i], ys[i]);
            area.lineTo(xs[n - 1], h - bottom);
            area.close();
            Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
            fill.setStyle(Paint.Style.FILL);
            fill.setShader(new LinearGradient(0, top, 0, h, 0x557FB0FF, 0x007FB0FF, Shader.TileMode.CLAMP));
            c.drawPath(area, fill);

            Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
            line.setStyle(Paint.Style.STROKE);
            line.setStrokeWidth(2f * s);
            line.setStrokeJoin(Paint.Join.ROUND);
            line.setStrokeCap(Paint.Cap.ROUND);
            line.setColor(LINE);
            if (solidEnd > 0) c.drawPath(polyline(xs, ys, 0, solidEnd), line);
            if (solidEnd < n - 1) {
                // bouts carrés : avec des bouts ronds, le trait de 2 dp comblerait presque les trous des pointillés
                line.setStrokeCap(Paint.Cap.BUTT);
                line.setAlpha(0xC0);
                line.setPathEffect(new DashPathEffect(new float[]{5f * s, 4f * s}, 0));
                c.drawPath(polyline(xs, ys, solidEnd, n - 1), line);
            }

            Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
            dot.setStyle(Paint.Style.FILL);
            dot.setColor(0xFF151B38);
            c.drawCircle(xs[n - 1], ys[n - 1], 4.6f * s, dot);
            dot.setColor(LINE);
            c.drawCircle(xs[n - 1], ys[n - 1], 3.2f * s, dot);
            return b;
        } catch (Throwable e) {
            return null;
        }
    }

    private static Path polyline(float[] xs, float[] ys, int from, int to) {
        Path p = new Path();
        p.moveTo(xs[from], ys[from]);
        for (int i = from + 1; i <= to; i++) p.lineTo(xs[i], ys[i]);
        return p;
    }
}
